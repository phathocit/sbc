import { pgTable, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const tenantPolicies = pgTable("tenant_policies", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  confirmationMode: varchar("confirmation_mode", { length: 16 }).notNull().default("AUTO"),
  pendingExpiryMinutes: integer("pending_expiry_minutes").notNull().default(120),
  cancellationCutoffMinutes: integer("cancellation_cutoff_minutes").notNull().default(1440),
  rescheduleCutoffMinutes: integer("reschedule_cutoff_minutes").notNull().default(1440),
  minLeadMinutes: integer("min_lead_minutes").notNull().default(60),
  bookingHorizonDays: integer("booking_horizon_days").notNull().default(30),
  slotIntervalMinutes: integer("slot_interval_minutes").notNull().default(15),
  appointmentReminderMinutes: integer("appointment_reminder_minutes"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type TenantPolicy = typeof tenantPolicies.$inferSelect;
export type NewTenantPolicy = typeof tenantPolicies.$inferInsert;
