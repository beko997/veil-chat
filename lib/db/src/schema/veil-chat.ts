import { createInsertSchema } from "drizzle-zod";
import {
  customType,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

const encryptedBlob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const veilChatMessageKind = pgEnum("veil_chat_message_kind", [
  "text",
  "image",
  "video",
  "file",
]);

export const veilChatRoomsTable = pgTable("veil_chat_rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const veilChatMediaTable = pgTable("veil_chat_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => veilChatRoomsTable.id, { onDelete: "cascade" }),
  encryptedData: encryptedBlob("encrypted_data"),
  storageProvider: text("storage_provider"),
  storageKey: text("storage_key"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const veilChatMessagesTable = pgTable("veil_chat_messages", {
  id: serial("id").primaryKey(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => veilChatRoomsTable.id, { onDelete: "cascade" }),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  sender: text("sender"),
  kind: veilChatMessageKind("kind").notNull().default("text"),
  mediaId: uuid("media_id").references(() => veilChatMediaTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertVeilChatRoomSchema = createInsertSchema(
  veilChatRoomsTable,
).omit({ id: true, createdAt: true });
export type InsertVeilChatRoom = z.infer<typeof insertVeilChatRoomSchema>;
export type VeilChatRoom = typeof veilChatRoomsTable.$inferSelect;

export const insertVeilChatMediaSchema = createInsertSchema(
  veilChatMediaTable,
).omit({ id: true, createdAt: true });
export type InsertVeilChatMedia = z.infer<typeof insertVeilChatMediaSchema>;
export type VeilChatMedia = typeof veilChatMediaTable.$inferSelect;

export const insertVeilChatMessageSchema = createInsertSchema(
  veilChatMessagesTable,
).omit({ id: true, createdAt: true });
export type InsertVeilChatMessage = z.infer<typeof insertVeilChatMessageSchema>;
export type VeilChatMessage = typeof veilChatMessagesTable.$inferSelect;
