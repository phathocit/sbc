import { foreignKey, index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { tenants } from './tenants.js';

/** Append-only human action log. Callers must pass only safe business fields. */
export const platformAdminAuditEvents = pgTable('platform_admin_audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id').notNull(),
  tenantId: uuid('tenant_id'),
  entityType: varchar('entity_type', { length: 40 }).notNull(),
  entityId: varchar('entity_id', { length: 80 }).notNull(),
  action: varchar('action', { length: 80 }).notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  reason: text('reason'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: 'platform_admin_audit_actor_fk', columns: [table.actorUserId], foreignColumns: [users.id] }).onDelete('restrict'),
  foreignKey({ name: 'platform_admin_audit_tenant_fk', columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete('set null'),
  index('platform_admin_audit_time_idx').on(table.occurredAt),
  index('platform_admin_audit_entity_idx').on(table.entityType, table.entityId, table.occurredAt),
]);
