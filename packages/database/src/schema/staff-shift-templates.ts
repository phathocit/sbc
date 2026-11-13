import { pgTable, uuid, varchar, timestamp, unique, uniqueIndex, foreignKey, check, index, time } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants.js";

export const staffShiftTemplates = pgTable("staff_shift_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("staff_shift_templates_tenant_id_id_unique").on(table.tenantId, table.id),
  uniqueIndex("staff_shift_templates_tenant_name_uidx").on(table.tenantId, sql`lower(${table.name})`),
  check("staff_shift_templates_name_nonempty", sql`length(trim(${table.name})) BETWEEN 1 AND 80`),
]);

export const staffShiftTemplateIntervals = pgTable("staff_shift_template_intervals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  templateId: uuid("template_id").notNull(),
  localStart: time("local_start").notNull(),
  localEnd: time("local_end").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("staff_shift_template_intervals_tenant_id_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "staff_shift_template_intervals_template_tenant_fk", columns: [table.tenantId, table.templateId], foreignColumns: [staffShiftTemplates.tenantId, staffShiftTemplates.id] }).onDelete("cascade"),
  check("staff_shift_template_intervals_positive_interval", sql`${table.localStart} < ${table.localEnd}`),
  index("staff_shift_template_intervals_template_idx").on(table.tenantId, table.templateId, table.localStart),
]);

export type StaffShiftTemplate = typeof staffShiftTemplates.$inferSelect;
export type StaffShiftTemplateInterval = typeof staffShiftTemplateIntervals.$inferSelect;
