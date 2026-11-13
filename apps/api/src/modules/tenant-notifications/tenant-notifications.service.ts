import { Injectable, NotFoundException } from '@nestjs/common';
import type { TenantNotificationPageDto } from '@sbc/contracts';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { outboxMessages, tenantNotificationReads, tenantNotifications, tenantTelegramIntegrations } from '../../../../../packages/database/dist/schema/index.js';
import { db } from '../../database';

const PAGE_SIZE = 30;

export async function publishTenantNotification(
  tx: any,
  tenantId: string,
  type: string,
  title: string,
  description: string,
  actionPath: string,
  telegramDetails?: Record<string, unknown>,
): Promise<void> {
  const [notification] = await tx.insert(tenantNotifications).values({ tenantId, type, title, description, actionPath }).returning({ id: tenantNotifications.id });
  const [integration] = await tx.select({ enabled: tenantTelegramIntegrations.enabled, status: tenantTelegramIntegrations.status })
    .from(tenantTelegramIntegrations).where(eq(tenantTelegramIntegrations.tenantId, tenantId)).limit(1);
  if (integration?.enabled && integration.status === 'verified' && notification) {
    await tx.insert(outboxMessages).values({ tenantId, eventType: 'tenant.telegram.notification.requested', payload: { notificationId: notification.id, ...(telegramDetails ? { telegramDetails } : {}) } });
  }
  await tx.execute(sql`select pg_notify('tenant_notifications', ${tenantId})`);
}

@Injectable()
export class TenantNotificationsService {
  async list(tenantId: string, userId: string, page: number): Promise<TenantNotificationPageDto> {
    const rows = await db.select({ notification: tenantNotifications, readAt: tenantNotificationReads.readAt })
      .from(tenantNotifications)
      .leftJoin(tenantNotificationReads, and(
        eq(tenantNotificationReads.tenantId, tenantNotifications.tenantId),
        eq(tenantNotificationReads.notificationId, tenantNotifications.id),
        eq(tenantNotificationReads.userId, userId),
      ))
      .where(eq(tenantNotifications.tenantId, tenantId))
      .orderBy(desc(tenantNotifications.occurredAt), desc(tenantNotifications.id))
      .limit(PAGE_SIZE + 1).offset((page - 1) * PAGE_SIZE);
    const [unread] = await db.select({ value: sql<number>`count(*)::int` }).from(tenantNotifications)
      .leftJoin(tenantNotificationReads, and(
        eq(tenantNotificationReads.tenantId, tenantNotifications.tenantId),
        eq(tenantNotificationReads.notificationId, tenantNotifications.id),
        eq(tenantNotificationReads.userId, userId),
      ))
      .where(and(eq(tenantNotifications.tenantId, tenantId), isNull(tenantNotificationReads.readAt)));
    return {
      items: rows.slice(0, PAGE_SIZE).map(({ notification, readAt }) => ({
        id: notification.id, type: notification.type, title: notification.title,
        description: notification.description, actionPath: notification.actionPath,
        occurredAt: notification.occurredAt.toISOString(), isRead: readAt !== null,
      })),
      unreadCount: unread?.value ?? 0,
      hasMore: rows.length > PAGE_SIZE,
    };
  }

  async markRead(tenantId: string, userId: string, notificationId: string): Promise<{ read: true }> {
    const [row] = await db.select({ id: tenantNotifications.id }).from(tenantNotifications)
      .where(and(eq(tenantNotifications.id, notificationId), eq(tenantNotifications.tenantId, tenantId))).limit(1);
    if (!row) throw new NotFoundException('Không tìm thấy thông báo.');
    await db.insert(tenantNotificationReads).values({ tenantId, userId, notificationId }).onConflictDoNothing();
    await db.execute(sql`select pg_notify('tenant_notifications', ${tenantId})`);
    return { read: true };
  }

  async markAllRead(tenantId: string, userId: string): Promise<{ read: true }> {
    await db.execute(sql`insert into tenant_notification_reads (tenant_id, notification_id, user_id)
      select ${tenantId}::uuid, notification.id, ${userId}::uuid
      from tenant_notifications as notification
      left join tenant_notification_reads as read_state
        on read_state.tenant_id = notification.tenant_id
        and read_state.notification_id = notification.id
        and read_state.user_id = ${userId}::uuid
      where notification.tenant_id = ${tenantId}::uuid and read_state.read_at is null
      on conflict (notification_id, user_id) do nothing`);
    await db.execute(sql`select pg_notify('tenant_notifications', ${tenantId})`);
    return { read: true };
  }
}
