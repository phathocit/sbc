import { pgTable, uuid, varchar, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 63 }).notNull().unique(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  themeKey: varchar("theme_key", { length: 40 }),
  themeMode: varchar("theme_mode", { length: 12 }).notNull().default("light"),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("tenants_theme_key_valid", sql`${table.themeKey} is null or ${table.themeKey} in ('blueberry-cream', 'peach-soda', 'matcha-latte', 'lavender-pop', 'strawberry-milk', 'minty-fresh', 'coral-bloom', 'lemon-sorbet', 'cotton-candy')`),
  check("tenants_theme_mode_valid", sql`${table.themeMode} in ('light', 'dark')`),
]);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
