import { pgTable, uuid, varchar, boolean, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants.js";

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull().default("Main Location"),
    timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("locations_tenant_id_id_unique").on(table.tenantId, table.id),
    uniqueIndex("unique_active_location_per_tenant")
      .on(table.tenantId)
      .where(sql`${table.active} = true`),
  ],
);

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
