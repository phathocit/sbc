import { sql } from 'drizzle-orm';
import { bigint, boolean, check, foreignKey, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const platformTelegramIntegrations = pgTable('platform_telegram_integrations', {
  id: integer('id').primaryKey().default(1),
  botTokenCiphertext: text('bot_token_ciphertext').notNull(),
  botTokenIv: varchar('bot_token_iv', { length: 32 }).notNull(),
  botTokenAuthTag: varchar('bot_token_auth_tag', { length: 32 }).notNull(),
  botId: varchar('bot_id', { length: 32 }),
  botUsername: varchar('bot_username', { length: 64 }),
  chatId: varchar('chat_id', { length: 32 }),
  chatName: varchar('chat_name', { length: 255 }),
  pairingCodeHash: varchar('pairing_code_hash', { length: 64 }),
  pairingExpiresAt: timestamp('pairing_expires_at', { withTimezone: true }),
  authorizedAdminId: uuid('authorized_admin_id'),
  enabled: boolean('enabled').notNull().default(false),
  status: varchar('status', { length: 24 }).notNull().default('saved'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  lastErrorCode: varchar('last_error_code', { length: 64 }),
  lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
  lastDeliveryStatus: varchar('last_delivery_status', { length: 16 }),
  lastDeliveryErrorCode: varchar('last_delivery_error_code', { length: 64 }),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  lastUpdateId: bigint('last_update_id', { mode: 'number' }).notNull().default(0),
  pollLeaseOwner: varchar('poll_lease_owner', { length: 128 }),
  pollLeaseUntil: timestamp('poll_lease_until', { withTimezone: true }),
  updatedBy: uuid('updated_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('platform_telegram_singleton_check', sql`${table.id} = 1`),
  check('platform_telegram_status_check', sql`${table.status} in ('saved', 'verified', 'failed')`),
  check('platform_telegram_delivery_status_check', sql`${table.lastDeliveryStatus} is null or ${table.lastDeliveryStatus} in ('sent', 'failed')`),
  foreignKey({ name: 'platform_telegram_updated_by_fk', columns: [table.updatedBy], foreignColumns: [users.id] }).onDelete('restrict'),
  foreignKey({ name: 'platform_telegram_authorized_admin_fk', columns: [table.authorizedAdminId], foreignColumns: [users.id] }).onDelete('restrict'),
]);

export type PlatformTelegramIntegration = typeof platformTelegramIntegrations.$inferSelect;
