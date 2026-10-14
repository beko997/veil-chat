import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { logger } from "./logger";

export type MediaStorageProvider = "r2" | "b2";

type StorageClient = {
  client: S3Client;
  bucket: string;
};

const clients = new Map<MediaStorageProvider, StorageClient>();
const MEDIA_KEY_PATTERN =
  /^media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getLocalMediaPath(key: string): string {
  const match = MEDIA_KEY_PATTERN.exec(key);
  if (!match) throw new Error("The media storage key is invalid.");

  const configuredDirectory = process.env["MEDIA_LOCAL_STORAGE_DIR"]?.trim();
  const directory = configuredDirectory
    ? path.resolve(configuredDirectory)
    : path.resolve(process.cwd(), "../../.data/veil-chat-media");
  return path.join(directory, `${key.slice("media/".length)}.enc`);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set to use this media storage provider.`);
  }
  return value;
}

function createStorageClient(provider: MediaStorageProvider): StorageClient {
  const cached = clients.get(provider);
  if (cached) return cached;

  let endpoint: string;
  let region: string;
  let bucket: string;
  let accessKeyId: string;
  let secretAccessKey: string;

  if (provider === "r2") {
    const accountId = process.env["R2_ACCOUNT_ID"]?.trim();
    endpoint =
      process.env["R2_ENDPOINT"]?.trim() ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
    if (!endpoint) {
      throw new Error("R2_ACCOUNT_ID or R2_ENDPOINT must be set.");
    }
    region = "auto";
    bucket = requiredEnv("R2_BUCKET");
    accessKeyId = requiredEnv("R2_ACCESS_KEY_ID");
    secretAccessKey = requiredEnv("R2_SECRET_ACCESS_KEY");
  } else {
    region = requiredEnv("B2_REGION");
    endpoint =
      process.env["B2_ENDPOINT"]?.trim() ||
      `https://s3.${region}.backblazeb2.com`;
    bucket = requiredEnv("B2_BUCKET");
    accessKeyId = requiredEnv("B2_KEY_ID");
    secretAccessKey = requiredEnv("B2_APPLICATION_KEY");
  }

  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    maxAttempts: 3,
    // Avoid optional checksum headers not consistently implemented by
    // S3-compatible providers; S3 still enforces checksums when required.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  const storage = { client, bucket };
  clients.set(provider, storage);
  return storage;
}

function parseProvider(provider: string): MediaStorageProvider {
  if (provider === "r2" || provider === "b2") return provider;
  throw new Error(`Unsupported media storage provider: ${provider}.`);
}

export function getMediaStorageWriteProvider(): MediaStorageProvider {
  const configured = process.env["MEDIA_STORAGE_PROVIDER"]?.trim().toLowerCase();
  if (configured !== "r2" && configured !== "b2") {
    throw new Error(
      "Set MEDIA_STORAGE_PROVIDER to r2 or b2 before accepting file uploads.",
    );
  }

  // Validate provider settings before accepting a file upload.
  createStorageClient(configured);
  return configured;
}

export async function putEncryptedMedia(
  provider: MediaStorageProvider,
  key: string,
  body: Buffer,
): Promise<void> {
  const { client, bucket } = createStorageClient(provider);
  const localPath = getLocalMediaPath(key);
  const stagingPath = `${localPath}.${randomUUID()}.uploading`;
  await mkdir(path.dirname(localPath), { recursive: true });

  let uploadedToBucket = false;
  try {
    await writeFile(stagingPath, body, { flag: "wx" });
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(stagingPath),
        ContentLength: body.byteLength,
        ContentType: "application/octet-stream",
      }),
    );
    uploadedToBucket = true;
    await rename(stagingPath, localPath);
  } catch (error) {
    await unlink(stagingPath).catch(() => undefined);
    if (uploadedToBucket) {
      await client
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
        .catch((cleanupError: unknown) => {
          logger.error(
            { err: cleanupError, provider, key },
            "Could not remove media after a local staging failure",
          );
        });
    }
    throw error;
  }
}

export async function getEncryptedMedia(
  provider: string,
  key: string,
): Promise<Buffer> {
  const localPath = getLocalMediaPath(key);
  try {
    return await readFile(localPath);
  } catch (error) {
    if (!isMissingFile(error)) {
      logger.warn(
        { err: error, provider, key },
        "Could not read local media cache; falling back to object storage",
      );
    }
  }

  const { client, bucket } = createStorageClient(parseProvider(provider));
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );

  if (!response.Body) {
    throw new Error("The object storage provider returned an empty object.");
  }

  const bytes = Buffer.from(await response.Body.transformToByteArray());
  const stagingPath = `${localPath}.${randomUUID()}.cache`;

  try {
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(stagingPath, bytes, { flag: "wx" });
    await rename(stagingPath, localPath);
  } catch (error) {
    await unlink(stagingPath).catch(() => undefined);
    logger.warn(
      { err: error, provider, key },
      "Could not cache media fetched from object storage",
    );
  }

  return bytes;
}

export async function deleteEncryptedMedia(
  provider: MediaStorageProvider,
  key: string,
): Promise<void> {
  const { client, bucket } = createStorageClient(provider);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  const localPath = getLocalMediaPath(key);
  await unlink(localPath).catch((error: unknown) => {
    if (!isMissingFile(error)) {
      logger.warn(
        { err: error, provider, key },
        "Could not remove local media cache",
      );
    }
  });
}
