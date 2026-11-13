import { pgTable, uuid, varchar, timestamp, integer, jsonb, unique, index, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants.js";
import { locations } from "./locations.js";
import { customers } from "./customers.js";
import { services } from "./services.js";

export interface BookingServiceSnapshot {
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceMinor: number;
  currency: string;
  services?: Array<{ id: string; name: string; durationMinutes: number; priceMinor: number; staffId?: string | null; startsAt?: string; segmentIndex?: number }>;
}

export interface BookingPolicySnapshot {
  confirmationMode: "AUTO" | "MANUAL";
  pendingExpiryMinutes: number;
  cancellationCutoffMinutes: number;
  rescheduleCutoffMinutes: number;
  minLeadMinutes: number;
  bookingHorizonDays: number;
  slotIntervalMinutes: number;
  version: number;
}

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: uuid("location_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  serviceId: uuid("service_id").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  pendingExpiresAt: timestamp("pending_expires_at", { withTimezone: true }),
  customerNote: varchar("customer_note", { length: 1000 }),
  serviceSnapshot: jsonb("service_snapshot").$type<BookingServiceSnapshot>().notNull(),
  policySnapshot: jsonb("policy_snapshot").$type<BookingPolicySnapshot>().notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("bookings_tenant_id_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "bookings_location_tenant_fk", columns: [table.tenantId, table.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  foreignKey({ name: "bookings_customer_tenant_fk", columns: [table.tenantId, table.customerId], foreignColumns: [customers.tenantId, customers.id] }),
  foreignKey({ name: "bookings_service_tenant_fk", columns: [table.tenantId, table.serviceId], foreignColumns: [services.tenantId, services.id] }),
  check("bookings_positive_interval", sql`${table.startsAt} < ${table.endsAt}`),
  check("bookings_status_valid", sql`${table.status} IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'NO_SHOW')`),
  check("bookings_pending_expiry_valid", sql`(${table.status} = 'PENDING' AND ${table.pendingExpiresAt} IS NOT NULL) OR (${table.status} <> 'PENDING' AND ${table.pendingExpiresAt} IS NULL)`),
  index("bookings_tenant_location_start_idx").on(table.tenantId, table.locationId, table.startsAt),
  index("bookings_tenant_customer_created_idx").on(table.tenantId, table.customerId, table.createdAt),
  index("bookings_tenant_status_expiry_idx").on(table.tenantId, table.status, table.pendingExpiresAt),
  index("bookings_confirmed_reminder_due_idx").on(table.status, table.startsAt).where(sql`${table.status} = 'CONFIRMED'`),
]);

export type Booking = typeof bookings.$inferSelect;
