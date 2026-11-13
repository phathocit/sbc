import { pgTable, uuid, varchar, jsonb, timestamp, foreignKey, index } from "drizzle-orm/pg-core";
import { bookings } from "./bookings.js";

export const bookingEvents = pgTable("booking_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  bookingId: uuid("booking_id").notNull(),
  actorType: varchar("actor_type", { length: 16 }).notNull(),
  actorId: uuid("actor_id"),
  eventType: varchar("event_type", { length: 48 }).notNull(),
  summary: jsonb("summary").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "booking_events_booking_tenant_fk", columns: [table.tenantId, table.bookingId], foreignColumns: [bookings.tenantId, bookings.id] }).onDelete("cascade"),
  index("booking_events_tenant_booking_time_idx").on(table.tenantId, table.bookingId, table.occurredAt),
]);

export type BookingEvent = typeof bookingEvents.$inferSelect;
