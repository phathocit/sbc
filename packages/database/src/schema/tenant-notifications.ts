import { pgTable, uuid, varchar, timestamp, primaryKey, foreignKey, index, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const tenantNotifications = pgTable('tenant_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  type: varchar('type', { length: 64 }).notNull(),
  title: varchar('title', { length: 180 }).notNull(),
  description: varchar('description', { length: 500 }).notNull(),
  actionPath: varchar('action_path', { length: 500 }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: 'tenant_notifications_tenant_fk', columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
  unique('tenant_notifications_tenant_id_id_unique').on(table.tenantId, table.id),
  index('tenant_notifications_tenant_time_idx').on(table.tenantId, table.occurredAt),
]);

export const tenantNotificationReads = pgTable('tenant_notification_reads', {
  tenantId: uuid('tenant_id').notNull(),
  notificationId: uuid('notification_id').notNull(),
  userId: uuid('user_id').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ name: 'tenant_notification_reads_pk', columns: [table.notificationId, table.userId] }),
  foreignKey({ name: 'tenant_notification_reads_notification_fk', columns: [table.tenantId, table.notificationId], foreignColumns: [tenantNotifications.tenantId, tenantNotifications.id] }).onDelete('cascade'),
  foreignKey({ name: 'tenant_notification_reads_user_fk', columns: [table.userId], foreignColumns: [users.id] }).onDelete('cascade'),
  index('tenant_notification_reads_user_idx').on(table.tenantId, table.userId),
]);
