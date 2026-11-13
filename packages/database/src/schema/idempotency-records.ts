import { pgTable, uuid, varchar, timestamp, unique, foreignKey } from "drizzle-orm/pg-core";
import { bookings } from "./bookings.js";

export const idempotencyRecords = pgTable("idempotency_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  actorId: uuid("actor_id").notNull(),
  operation: varchar("operation", { length: 48 }).notNull(),
  key: varchar("key", { length: 255 }).notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  resultBookingId: uuid("result_booking_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  unique("idempotency_tenant_actor_operation_key_unique").on(table.tenantId, table.actorId, table.operation, table.key),
  foreignKey({ name: "idempotency_booking_tenant_fk", columns: [table.tenantId, table.resultBookingId], foreignColumns: [bookings.tenantId, bookings.id] }).onDelete("cascade"),
]);

export type IdempotencyRecord = typeof idempotencyRecords.$inferSelect;
