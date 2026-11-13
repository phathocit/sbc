import { pgTable, uuid, varchar, integer, boolean, timestamp, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants.js";

export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  description: varchar("description", { length: 2000 }),
  durationMinutes: integer("duration_minutes").notNull(),
  bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
  bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
  priceMinor: integer("price_minor").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull(),
  active: boolean("active").notNull().default(true),
  published: boolean("published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("services_tenant_id_id_unique").on(table.tenantId, table.id),
  check("services_duration_positive", sql`${table.durationMinutes} > 0`),
  check("services_buffers_nonnegative", sql`${table.bufferBeforeMinutes} >= 0 AND ${table.bufferAfterMinutes} >= 0`),
  check("services_price_nonnegative", sql`${table.priceMinor} >= 0`),
]);

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
