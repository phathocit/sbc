import { pgTable, uuid, varchar, timestamp, unique, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  emailNormalized: varchar("email_normalized", { length: 255 }),
  phoneNormalized: varchar("phone_normalized", { length: 32 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("customers_tenant_id_id_unique").on(table.tenantId, table.id),
  index("customers_tenant_created_idx").on(table.tenantId, table.createdAt),
  index("customers_tenant_phone_lookup_idx").on(table.tenantId, table.phoneNormalized),
  index("customers_tenant_email_lookup_idx").on(table.tenantId, table.emailNormalized),
]);

export type Customer = typeof customers.$inferSelect;
