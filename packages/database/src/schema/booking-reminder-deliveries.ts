import { pgTable, uuid, integer, timestamp, varchar, primaryKey, foreignKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { bookings } from './bookings.js';
import { tenantNotifications } from './tenant-notifications.js';
import { tenants } from './tenants.js';

export const bookingReminderDeliveries = pgTable('booking_reminder_deliveries', {
  tenantId: uuid('tenant_id').notNull(),
  bookingId: uuid('booking_id').notNull(),
  scheduledStartsAt: timestamp('scheduled_starts_at', { withTimezone: true }).notNull(),
  reminderType: varchar('reminder_type', { length: 24 }).notNull(),
  notificationId: uuid('notification_id').notNull(),
  leadMinutes: integer('lead_minutes').notNull(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ name: 'booking_reminder_deliveries_pk', columns: [table.tenantId, table.bookingId, table.scheduledStartsAt, table.reminderType] }),
  foreignKey({ name: 'booking_reminder_deliveries_tenant_fk', columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
  foreignKey({ name: 'booking_reminder_deliveries_booking_fk', columns: [table.tenantId, table.bookingId], foreignColumns: [bookings.tenantId, bookings.id] }).onDelete('cascade'),
  foreignKey({ name: 'booking_reminder_deliveries_notification_fk', columns: [table.tenantId, table.notificationId], foreignColumns: [tenantNotifications.tenantId, tenantNotifications.id] }).onDelete('cascade'),
  check('booking_reminder_deliveries_type_check', sql`${table.reminderType} in ('confirmation_20', 'confirmation_10', 'confirmation_5', 'upcoming')`),
  check('booking_reminder_deliveries_lead_minutes_check', sql`${table.leadMinutes} between 1 and 1440`),
]);

export type BookingReminderDelivery = typeof bookingReminderDeliveries.$inferSelect;
export type NewBookingReminderDelivery = typeof bookingReminderDeliveries.$inferInsert;
