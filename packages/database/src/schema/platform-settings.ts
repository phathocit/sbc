import { pgTable, integer, text, varchar, timestamp, uuid, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";

export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "platform_admins_user_fk", columns: [table.userId], foreignColumns: [users.id] }).onDelete("restrict"),
]);

export const platformSettings = pgTable("platform_settings", {
  id: integer("id").primaryKey().default(1),
  ciphertext: text("ciphertext").notNull(),
  iv: varchar("iv", { length: 16 }).notNull(),
  authTag: varchar("auth_tag", { length: 32 }).notNull(),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("platform_settings_singleton_check", sql`${table.id} = 1`),
  foreignKey({ name: "platform_settings_updated_by_fk", columns: [table.updatedBy], foreignColumns: [users.id] }),
]);

export type PlatformAdmin = typeof platformAdmins.$inferSelect;
export type PlatformSettingsRow = typeof platformSettings.$inferSelect;
