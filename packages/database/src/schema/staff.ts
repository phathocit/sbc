import { pgTable, uuid, varchar, boolean, timestamp, unique, foreignKey } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { locations } from "./locations.js";
import { memberships } from "./memberships.js";

export const staffProfiles = pgTable("staff_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: uuid("location_id").notNull(),
  userId: uuid("user_id"),
  name: varchar("name", { length: 160 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("staff_profiles_tenant_id_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "staff_profiles_location_tenant_fk", columns: [table.tenantId, table.locationId], foreignColumns: [locations.tenantId, locations.id] }).onDelete("cascade"),
  foreignKey({ name: "staff_profiles_membership_user_fk", columns: [table.tenantId, table.userId], foreignColumns: [memberships.tenantId, memberships.userId] }),
]);

export type StaffProfile = typeof staffProfiles.$inferSelect;
export type NewStaffProfile = typeof staffProfiles.$inferInsert;
