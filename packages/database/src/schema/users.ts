import { check, pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash"),
  accountStatus: varchar("account_status", { length: 24 }).notNull().default("active"),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("users_account_status_valid", sql`${table.accountStatus} IN ('active', 'pending_activation')`),
  check("users_active_password_required", sql`${table.accountStatus} <> 'active' OR ${table.passwordHash} IS NOT NULL`),
]);

export type UserAccountStatus = 'active' | 'pending_activation';

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
