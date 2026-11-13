import { pgTable, uuid, varchar, timestamp, foreignKey, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";

export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  sessionType: varchar("session_type", { length: 24 }).notNull(),
  refreshTokenHash: varchar("refresh_token_hash", { length: 64 }).notNull(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull(),
  idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "auth_sessions_user_fk", columns: [table.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  check("auth_sessions_type_valid", sql`${table.sessionType} IN ('platform_admin', 'tenant')`),
  check("auth_sessions_idle_before_absolute", sql`${table.idleExpiresAt} <= ${table.absoluteExpiresAt}`),
  index("auth_sessions_user_active_idx").on(table.userId, table.revokedAt),
  index("auth_sessions_expiry_idx").on(table.idleExpiresAt, table.absoluteExpiresAt),
]);

export type AuthSession = typeof authSessions.$inferSelect;
