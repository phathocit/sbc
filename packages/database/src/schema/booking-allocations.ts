import { pgTable, uuid, timestamp, boolean, integer, uniqueIndex, foreignKey, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bookings } from "./bookings.js";
import { staffProfiles } from "./staff.js";

export const bookingAllocations = pgTable("booking_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  bookingId: uuid("booking_id").notNull(),
  segmentIndex: integer("segment_index").notNull().default(0),
  staffId: uuid("staff_id").notNull(),
  occupiedStart: timestamp("occupied_start", { withTimezone: true }).notNull(),
  occupiedEnd: timestamp("occupied_end", { withTimezone: true }).notNull(),
  active: boolean("active").notNull().default(true),
  isCurrent: boolean("is_current").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "booking_allocations_booking_tenant_fk", columns: [table.tenantId, table.bookingId], foreignColumns: [bookings.tenantId, bookings.id] }).onDelete("cascade"),
  foreignKey({ name: "booking_allocations_staff_tenant_fk", columns: [table.tenantId, table.staffId], foreignColumns: [staffProfiles.tenantId, staffProfiles.id] }),
  uniqueIndex("booking_allocations_one_active_per_segment").on(table.tenantId, table.bookingId, table.segmentIndex).where(sql`${table.active} = true`),
  uniqueIndex("booking_allocations_one_current_per_segment").on(table.tenantId, table.bookingId, table.segmentIndex).where(sql`${table.isCurrent} = true`),
  index("booking_allocations_tenant_staff_start_idx").on(table.tenantId, table.staffId, table.occupiedStart),
  check("booking_allocations_positive_interval", sql`${table.occupiedStart} < ${table.occupiedEnd}`),
  check("booking_allocations_active_is_current", sql`NOT ${table.active} OR ${table.isCurrent}`),
]);

export type BookingAllocation = typeof bookingAllocations.$inferSelect;
