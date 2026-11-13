import { pgTable, uuid, varchar, date, time, boolean, timestamp, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { locations } from "./locations.js";
import { staffProfiles } from "./staff.js";

export const scheduleExceptions = pgTable("schedule_exceptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  scope: varchar("scope", { length: 16 }).notNull(),
  locationId: uuid("location_id"),
  staffId: uuid("staff_id"),
  onDate: date("on_date").notNull(),
  localStart: time("local_start").notNull(),
  localEnd: time("local_end").notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  reason: varchar("reason", { length: 500 }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "schedule_exceptions_location_tenant_fk", columns: [table.tenantId, table.locationId], foreignColumns: [locations.tenantId, locations.id] }).onDelete("cascade"),
  foreignKey({ name: "schedule_exceptions_staff_tenant_fk", columns: [table.tenantId, table.staffId], foreignColumns: [staffProfiles.tenantId, staffProfiles.id] }).onDelete("cascade"),
  check("schedule_exceptions_scope_target", sql`(${table.scope} = 'location' AND ${table.locationId} IS NOT NULL AND ${table.staffId} IS NULL) OR (${table.scope} = 'staff' AND ${table.staffId} IS NOT NULL AND ${table.locationId} IS NULL)`),
  check("schedule_exceptions_kind", sql`${table.kind} IN ('unavailable', 'available')`),
  check("schedule_exceptions_positive_interval", sql`${table.localStart} < ${table.localEnd}`),
]);

export type ScheduleException = typeof scheduleExceptions.$inferSelect;
