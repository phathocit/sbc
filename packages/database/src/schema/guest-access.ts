import { pgTable, uuid, varchar, timestamp, unique, foreignKey, index, integer, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bookings } from "./bookings.js";
import { tenants } from "./tenants.js";

export const guestAccessTokens = pgTable("guest_access_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  bookingId: uuid("booking_id").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  scope: varchar("scope", { length: 32 }).notNull().default("booking:manage"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "guest_access_tokens_tenant_fk", columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("cascade"),
  foreignKey({ name: "guest_access_tokens_booking_fk", columns: [table.tenantId, table.bookingId], foreignColumns: [bookings.tenantId, bookings.id] }).onDelete("cascade"),
  unique("guest_access_tokens_tenant_booking_id_unique").on(table.tenantId, table.bookingId, table.id),
  index("guest_access_tokens_booking_idx").on(table.tenantId, table.bookingId, table.createdAt),
]);

export const guestAccessSessions = pgTable("guest_access_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  bookingId: uuid("booking_id").notNull(),
  tokenId: uuid("token_id").notNull(),
  sessionHash: varchar("session_hash", { length: 64 }).notNull().unique(),
  scope: varchar("scope", { length: 32 }).notNull().default("booking:manage"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "guest_access_sessions_tenant_fk", columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("cascade"),
  foreignKey({ name: "guest_access_sessions_booking_fk", columns: [table.tenantId, table.bookingId], foreignColumns: [bookings.tenantId, bookings.id] }).onDelete("cascade"),
  foreignKey({ name: "guest_access_sessions_token_fk", columns: [table.tenantId, table.bookingId, table.tokenId], foreignColumns: [guestAccessTokens.tenantId, guestAccessTokens.bookingId, guestAccessTokens.id] }).onDelete("cascade"),
  index("guest_access_sessions_booking_idx").on(table.tenantId, table.bookingId, table.expiresAt),
]);

export const publicRateLimits = pgTable("public_rate_limits", {
  id: uuid("id").primaryKey().defaultRandom(),
  keyHash: varchar("key_hash", { length: 64 }).notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  requestCount: integer("request_count").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("public_rate_limits_key_window_unique").on(table.keyHash, table.windowStart),
  check("public_rate_limits_count_positive", sql`${table.requestCount} > 0`),
  index("public_rate_limits_created_idx").on(table.createdAt),
]);
