import { pgTable, uuid, varchar, text, timestamp, foreignKey, index, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { billingOrders } from './billing.js';

export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  createdBy: uuid('created_by').notNull(),
  billingOrderId: uuid('billing_order_id'),
  subject: varchar('subject', { length: 140 }).notNull(),
  category: varchar('category', { length: 32 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('waiting_admin'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('support_tickets_tenant_id_id_unique').on(table.tenantId, table.id),
  foreignKey({ name: 'support_tickets_tenant_fk', columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
  foreignKey({ name: 'support_tickets_created_by_fk', columns: [table.createdBy], foreignColumns: [users.id] }).onDelete('restrict'),
  foreignKey({ name: 'support_tickets_billing_order_fk', columns: [table.tenantId, table.billingOrderId], foreignColumns: [billingOrders.tenantId, billingOrders.id] }).onDelete('restrict'),
  check('support_tickets_category_check', sql`${table.category} IN ('billing', 'account', 'booking', 'technical', 'other')`),
  check('support_tickets_status_check', sql`${table.status} IN ('waiting_admin', 'waiting_tenant', 'resolved', 'closed')`),
  index('support_tickets_tenant_updated_idx').on(table.tenantId, table.updatedAt),
  index('support_tickets_status_updated_idx').on(table.status, table.updatedAt),
]);

export const supportMessages = pgTable('support_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  ticketId: uuid('ticket_id').notNull(),
  senderId: uuid('sender_id').notNull(),
  senderRole: varchar('sender_role', { length: 16 }).notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: 'support_messages_ticket_fk', columns: [table.tenantId, table.ticketId], foreignColumns: [supportTickets.tenantId, supportTickets.id] }).onDelete('cascade'),
  foreignKey({ name: 'support_messages_sender_fk', columns: [table.senderId], foreignColumns: [users.id] }).onDelete('restrict'),
  check('support_messages_sender_role_check', sql`${table.senderRole} IN ('tenant', 'platform_admin')`),
  check('support_messages_body_length_check', sql`length(trim(${table.body})) BETWEEN 1 AND 5000`),
  index('support_messages_ticket_time_idx').on(table.tenantId, table.ticketId, table.createdAt),
]);

export type SupportTicket = typeof supportTickets.$inferSelect;
export type SupportMessage = typeof supportMessages.$inferSelect;
