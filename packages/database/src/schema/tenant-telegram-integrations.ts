import { pgTable, uuid, text, varchar, boolean, timestamp, foreignKey, check, index, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.js';

export const tenantTelegramIntegrations = pgTable('tenant_telegram_integrations', {
  tenantId: uuid('tenant_id').primaryKey(),
  botTokenCiphertext: text('bot_token_ciphertext').notNull(),
  botTokenIv: varchar('bot_token_iv', { length: 32 }).notNull(),
  botTokenAuthTag: varchar('bot_token_auth_tag', { length: 32 }).notNull(),
  botUsername: varchar('bot_username', { length: 64 }),
  chatId: varchar('chat_id', { length: 32 }),
  chatTitle: varchar('chat_title', { length: 255 }),
  chatType: varchar('chat_type', { length: 16 }),
  enabled: boolean('enabled').notNull().default(false),
  status: varchar('status', { length: 24 }).notNull().default('saved'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  lastErrorCode: varchar('last_error_code', { length: 64 }),
  lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
  lastDeliveryStatus: varchar('last_delivery_status', { length: 16 }),
  lastDeliveryErrorCode: varchar('last_delivery_error_code', { length: 64 }),
  pairingCodeHash: varchar('pairing_code_hash', { length: 64 }),
  pairingExpiresAt: timestamp('pairing_expires_at', { withTimezone: true }),
  candidateChats: jsonb('candidate_chats').$type<Array<{ chatId: string; title: string | null; type: 'group' | 'supergroup' }>>().notNull().default(sql`'[]'::jsonb`),
  lastDiscoveryAt: timestamp('last_discovery_at', { withTimezone: true }),
  pollingUntil: timestamp('polling_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: 'tenant_telegram_integrations_tenant_fk', columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
  check('tenant_telegram_integrations_status_check', sql`${table.status} in ('saved', 'verified', 'failed')`),
  check('tenant_telegram_integrations_chat_type_check', sql`${table.chatType} is null or ${table.chatType} in ('group', 'supergroup')`),
  index('tenant_telegram_integrations_enabled_idx').on(table.enabled, table.status),
]);

export type TenantTelegramIntegration = typeof tenantTelegramIntegrations.$inferSelect;
