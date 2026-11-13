import { pgTable, uuid, timestamp, primaryKey, foreignKey } from "drizzle-orm/pg-core";
import { services } from "./services.js";
import { staffProfiles } from "./staff.js";

export const staffServices = pgTable("staff_services", {
  tenantId: uuid("tenant_id").notNull(),
  staffId: uuid("staff_id").notNull(),
  serviceId: uuid("service_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.staffId, table.serviceId] }),
  foreignKey({ name: "staff_services_staff_tenant_fk", columns: [table.tenantId, table.staffId], foreignColumns: [staffProfiles.tenantId, staffProfiles.id] }).onDelete("cascade"),
  foreignKey({ name: "staff_services_service_tenant_fk", columns: [table.tenantId, table.serviceId], foreignColumns: [services.tenantId, services.id] }).onDelete("cascade"),
]);

export type StaffService = typeof staffServices.$inferSelect;
