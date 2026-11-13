import { pgTable, uuid, integer, time, timestamp, unique, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { locations } from "./locations.js";

export const businessHours = pgTable("business_hours", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  locationId: uuid("location_id").notNull(),
  weekday: integer("weekday").notNull(),
  localStart: time("local_start").notNull(),
  localEnd: time("local_end").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("business_hours_tenant_id_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "business_hours_location_tenant_fk", columns: [table.tenantId, table.locationId], foreignColumns: [locations.tenantId, locations.id] }).onDelete("cascade"),
  check("business_hours_weekday_range", sql`${table.weekday} BETWEEN 0 AND 6`),
  check("business_hours_positive_interval", sql`${table.localStart} < ${table.localEnd}`),
]);

export type BusinessHour = typeof businessHours.$inferSelect;
