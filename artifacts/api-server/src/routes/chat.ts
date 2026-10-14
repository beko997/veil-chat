import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import {
  CreateRoomBody,
  CreateRoomResponse,
  GetRoomMediaParams,
  GetRoomMediaResponse,
  ListRoomMessagesQueryParams,
  ListRoomMessagesResponse,
  SendRoomMessageBody,
  SendRoomMessageParams,
  SendRoomMessageResponse,
} from "@workspace/api-zod";
import {
  db,
  type VeilChatMessage,
  veilChatMediaTable,
  veilChatMessagesTable,
  veilChatRoomsTable,
} from "@workspace/db";
import {
  deleteEncryptedMedia,
  getEncryptedMedia,
  getMediaStorageWriteProvider,
  putEncryptedMedia,
  type MediaStorageProvider,
} from "../lib/media-storage";

const router: IRouter = Router();
// 10 MiB plaintext + ECDH media envelope (10-byte marker, 65-byte public key,
// 12-byte AES-GCM IV, and 16-byte authentication tag).
const MAX_ENCRYPTED_MEDIA_BYTES = 10 * 1024 * 1024 + 103;

router.post("/rooms", async (req, res): Promise<void> => {
  const parsed = CreateRoomBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [room] = await db
    .insert(veilChatRoomsTable)
    .values({ label: parsed.data.label ?? null })
    .returning();

  res.status(201).json(CreateRoomResponse.parse(room));
});

router.get("/messages", async (req, res): Promise<void> => {
  const parsed = ListRoomMessagesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { roomId, afterId, beforeId, limit } = parsed.data;
  if (afterId !== undefined && beforeId !== undefined) {
    res.status(400).json({ error: "Use either afterId or beforeId, not both." });
    return;
  }

  const [room] = await db
    .select({ id: veilChatRoomsTable.id })
    .from(veilChatRoomsTable)
    .where(eq(veilChatRoomsTable.id, roomId))
    .limit(1);

  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  const conditions = [eq(veilChatMessagesTable.roomId, roomId)];
  if (afterId !== undefined) {
    conditions.push(gt(veilChatMessagesTable.id, afterId));
  }
  if (beforeId !== undefined) {
    conditions.push(lt(veilChatMessagesTable.id, beforeId));
  }

  const useNewestPage = afterId === undefined;
  const rows = await db
    .select()
    .from(veilChatMessagesTable)
    .where(and(...conditions))
    .orderBy(useNewestPage ? desc(veilChatMessagesTable.id) : asc(veilChatMessagesTable.id))
    .limit(limit);

  if (useNewestPage) rows.reverse();
  res.json(ListRoomMessagesResponse.parse(rows));
});

router.post("/rooms/:roomId/messages", async (req, res): Promise<void> => {
  const params = SendRoomMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = SendRoomMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { roomId } = params.data;
  const { ciphertext, iv, sender, kind, mediaData } = parsed.data;
  const hasMedia = mediaData != null;

  if ((kind === "text" && hasMedia) || (kind !== "text" && !hasMedia)) {
    res.status(400).json({ error: "Media bytes are required only for file messages." });
    return;
  }

  let encryptedBytes: Buffer | null = null;
  let storageProvider: MediaStorageProvider | null = null;
  if (mediaData != null) {
    encryptedBytes = Buffer.from(mediaData, "base64");
    const canonicalBase64 = encryptedBytes.toString("base64");
    if (
      encryptedBytes.byteLength === 0 ||
      encryptedBytes.byteLength > MAX_ENCRYPTED_MEDIA_BYTES ||
      canonicalBase64 !== mediaData
    ) {
      res.status(400).json({ error: "Media must be valid base64 and the original file must be no larger than 10 MiB." });
      return;
    }

    try {
      storageProvider = getMediaStorageWriteProvider();
    } catch (error) {
      req.log.error({ err: error }, "Media storage configuration is invalid");
      res.status(503).json({ error: "Media storage is misconfigured." });
      return;
    }
  }

  const [room] = await db
    .select({ id: veilChatRoomsTable.id })
    .from(veilChatRoomsTable)
    .where(eq(veilChatRoomsTable.id, roomId))
    .limit(1);

  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  const mediaId = encryptedBytes ? randomUUID() : null;
  const storageKey =
    encryptedBytes && storageProvider && mediaId ? `media/${mediaId}` : null;

  if (encryptedBytes && storageProvider && storageKey) {
    try {
      await putEncryptedMedia(storageProvider, storageKey, encryptedBytes);
    } catch (error) {
      req.log.error(
        { err: error, provider: storageProvider },
        "Could not upload encrypted media",
      );
      res.status(503).json({ error: "Media storage is temporarily unavailable." });
      return;
    }
  }

  let message: VeilChatMessage;
  try {
    message = await db.transaction(async (tx) => {
      if (encryptedBytes && mediaId) {
        await tx.insert(veilChatMediaTable).values({
          id: mediaId,
          roomId,
          encryptedData: storageKey ? null : encryptedBytes,
          storageProvider,
          storageKey,
        });
      }

      const [created] = await tx
        .insert(veilChatMessagesTable)
        .values({
          roomId,
          ciphertext,
          iv,
          sender: sender ?? null,
          kind,
          mediaId,
        })
        .returning();

      return created;
    });
  } catch (error) {
    if (storageProvider && storageKey) {
      try {
        await deleteEncryptedMedia(storageProvider, storageKey);
      } catch (cleanupError) {
        req.log.error(
          {
            err: cleanupError,
            provider: storageProvider,
          },
          "Could not remove orphaned encrypted media after a failed message transaction",
        );
      }
    }
    throw error;
  }

  res.status(201).json(SendRoomMessageResponse.parse(message));
});

router.get(
  "/rooms/:roomId/media/:mediaId",
  async (req, res): Promise<void> => {
    const params = GetRoomMediaParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [media] = await db
      .select({
        encryptedData: veilChatMediaTable.encryptedData,
        storageProvider: veilChatMediaTable.storageProvider,
        storageKey: veilChatMediaTable.storageKey,
      })
      .from(veilChatMediaTable)
      .where(
        and(
          eq(veilChatMediaTable.id, params.data.mediaId),
          eq(veilChatMediaTable.roomId, params.data.roomId),
        ),
      )
      .limit(1);

    if (!media) {
      res.status(404).json({ error: "Media not found." });
      return;
    }

    let encryptedData: Buffer;
    if (media.storageProvider !== null || media.storageKey !== null) {
      if (
        !media.storageProvider ||
        !media.storageKey ||
        media.encryptedData !== null
      ) {
        req.log.error(
          { mediaId: params.data.mediaId },
          "Media storage metadata is inconsistent",
        );
        res.status(500).json({ error: "Media storage metadata is invalid." });
        return;
      }

      try {
        encryptedData = await getEncryptedMedia(
          media.storageProvider,
          media.storageKey,
        );
      } catch (error) {
        req.log.error(
          { err: error, provider: media.storageProvider },
          "Could not retrieve encrypted media",
        );
        res.status(503).json({ error: "Media storage is temporarily unavailable." });
        return;
      }
    } else if (media.encryptedData) {
      // Older messages keep their encrypted bytes in PostgreSQL.
      encryptedData = media.encryptedData;
    } else {
      req.log.error(
        { mediaId: params.data.mediaId },
        "Media has neither database bytes nor an object storage key",
      );
      res.status(500).json({ error: "Media data is missing." });
      return;
    }

    res.json(
      GetRoomMediaResponse.parse({
        data: encryptedData.toString("base64"),
      }),
    );
  },
);

export default router;
