import { pgTable, uuid, varchar, jsonb, timestamp, integer, index, foreignKey } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const outboxMessages = pgTable("outbox_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id"),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  payload: jsonb("payload").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  failureReason: varchar("failure_reason", { length: 1000 }),
  leaseOwner: varchar("lease_owner", { length: 128 }),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
}, (table) => [
  foreignKey({ name: "outbox_messages_tenant_fk", columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("cascade"),
  index("outbox_messages_pending_idx").on(table.nextAttemptAt, table.occurredAt),
  index("outbox_messages_guest_delivery_idx").on(table.nextAttemptAt, table.leaseUntil, table.occurredAt),
]);

export type OutboxMessage = typeof outboxMessages.$inferSelect;
