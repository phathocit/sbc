import { pgTable, uuid, integer, time, timestamp, unique, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { staffProfiles } from "./staff.js";

export const staffHours = pgTable("staff_hours", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  staffId: uuid("staff_id").notNull(),
  weekday: integer("weekday").notNull(),
  localStart: time("local_start").notNull(),
  localEnd: time("local_end").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("staff_hours_tenant_id_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "staff_hours_staff_tenant_fk", columns: [table.tenantId, table.staffId], foreignColumns: [staffProfiles.tenantId, staffProfiles.id] }).onDelete("cascade"),
  check("staff_hours_weekday_range", sql`${table.weekday} BETWEEN 0 AND 6`),
  check("staff_hours_positive_interval", sql`${table.localStart} < ${table.localEnd}`),
]);

export type StaffHour = typeof staffHours.$inferSelect;
