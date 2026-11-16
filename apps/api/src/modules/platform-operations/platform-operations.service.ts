import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { db } from '../../database';

type QueueKind = 'application' | 'support' | 'payment' | 'invitation_email' | 'email_failure' | 'telegram_failure' | 'webhook';
export type WorkItem = { kind: QueueKind; id: string; tenantId: string | null; title: string; detail: string; occurredAt: string; target: 'applications' | 'support' | 'billing' | 'tenants' | 'settings'; targetId: string | null };
export type OperationsOverview = { work: WorkItem[]; health: { webhook: { failed: number; stale: number }; email: { retrying: number; failed: number; oldestPendingMinutes: number | null }; telegram: { retrying: number; failed: number; oldestPendingMinutes: number | null; connection: string } }; checkedAt: string };

@Injectable()
export class PlatformOperationsService {
  async overview(): Promise<OperationsOverview> {
    const [applications, tickets, payments, deliveries, webhookEvents, healthRows] = await Promise.all([
      db.execute(sql`select id, name, created_at from tenant_applications where status = 'pending' order by created_at asc limit 10`),
      db.execute(sql`select t.id, t.tenant_id, t.subject, t.updated_at, ten.display_name from support_tickets t join tenants ten on ten.id = t.tenant_id where t.status = 'waiting_admin' order by t.updated_at asc limit 10`),
      db.execute(sql`select o.id, o.tenant_id, o.status, o.updated_at, o.expires_at, ten.display_name from billing_orders o join tenants ten on ten.id = o.tenant_id where o.status = 'paid_review' or (o.status = 'pending' and o.expires_at < now()) order by o.updated_at asc limit 10`),
      db.execute(sql`select o.id, o.tenant_id, o.event_type, o.occurred_at, o.failure_reason, ten.display_name from outbox_messages o left join tenants ten on ten.id = o.tenant_id where o.dead_lettered_at is not null and (o.event_type like '%email.requested' or o.event_type = 'tenant_owner_invitation.requested' or o.event_type like '%telegram%' or o.failure_reason like 'TELEGRAM_%') order by o.occurred_at asc limit 10`),
      db.execute(sql`select w.id, w.order_id, w.received_at, w.status from payment_webhook_events w where w.status = 'failed' or (w.status = 'received' and w.received_at < now() - interval '5 minutes') order by w.received_at asc limit 10`),
      db.execute(sql`select
        (select count(*)::int from payment_webhook_events where status = 'failed') as webhook_failed,
        (select count(*)::int from payment_webhook_events where status = 'received' and received_at < now() - interval '5 minutes') as webhook_stale,
        (select count(*)::int from outbox_messages where processed_at is null and dead_lettered_at is null and (event_type like '%email.requested' or event_type = 'tenant_owner_invitation.requested')) as email_retrying,
        (select count(*)::int from outbox_messages where dead_lettered_at is not null and (event_type like '%email.requested' or event_type = 'tenant_owner_invitation.requested')) as email_failed,
        (select extract(epoch from now() - min(occurred_at)) / 60 from outbox_messages where processed_at is null and dead_lettered_at is null and (event_type like '%email.requested' or event_type = 'tenant_owner_invitation.requested')) as email_oldest,
        (select count(*)::int from outbox_messages where processed_at is null and dead_lettered_at is null and (event_type like '%telegram%' or failure_reason like 'TELEGRAM_%')) as telegram_retrying,
        (select count(*)::int from outbox_messages where dead_lettered_at is not null and (event_type like '%telegram%' or failure_reason like 'TELEGRAM_%')) as telegram_failed,
        (select extract(epoch from now() - min(occurred_at)) / 60 from outbox_messages where processed_at is null and dead_lettered_at is null and (event_type like '%telegram%' or failure_reason like 'TELEGRAM_%')) as telegram_oldest,
        (select case when enabled and status = 'verified' then 'connected' else status end from platform_telegram_integrations where id = 1) as telegram_connection`),
    ]);
    type Row = Record<string, unknown>;
    const date = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
    const work: WorkItem[] = [];
    for (const row of applications as Row[]) work.push({ kind: 'application', id: String(row.id), tenantId: null, title: String(row.name), detail: 'Hồ sơ chờ duyệt', occurredAt: date(row.created_at), target: 'applications', targetId: String(row.id) });
    for (const row of tickets as Row[]) work.push({ kind: 'support', id: String(row.id), tenantId: String(row.tenant_id), title: String(row.subject), detail: `${row.display_name} · chờ phản hồi`, occurredAt: date(row.updated_at), target: 'support', targetId: String(row.id) });
    for (const row of payments as Row[]) work.push({ kind: 'payment', id: String(row.id), tenantId: String(row.tenant_id), title: String(row.display_name), detail: row.status === 'paid_review' ? 'Đã thu · cần xử lý' : 'Đơn quá hạn · cần đối soát', occurredAt: date(row.updated_at), target: 'billing', targetId: String(row.id) });
    for (const row of deliveries as Row[]) {
      const eventType = String(row.event_type);
      const kind: QueueKind = eventType === 'tenant_owner_invitation.requested' ? 'invitation_email' : eventType.includes('telegram') || String(row.failure_reason ?? '').startsWith('TELEGRAM_') ? 'telegram_failure' : 'email_failure';
      work.push({ kind, id: String(row.id), tenantId: row.tenant_id ? String(row.tenant_id) : null, title: row.display_name ? String(row.display_name) : 'Gửi thông báo thất bại', detail: kind === 'invitation_email' ? 'Email lời mời thất bại' : kind === 'telegram_failure' ? 'Telegram gửi thất bại' : 'Email gửi thất bại', occurredAt: date(row.occurred_at), target: kind === 'invitation_email' && row.tenant_id ? 'tenants' : 'settings', targetId: row.tenant_id ? String(row.tenant_id) : null });
    }
    for (const row of webhookEvents as Row[]) work.push({ kind: 'webhook', id: String(row.id), tenantId: null, title: `Webhook ${row.status === 'failed' ? 'xử lý lỗi' : 'chưa xử lý'}`, detail: 'Kiểm tra đơn và đối soát', occurredAt: date(row.received_at), target: 'billing', targetId: String(row.order_id) });
    work.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    const h = (healthRows as Row[])[0] ?? {};
    const count = (value: unknown) => Number(value ?? 0);
    const age = (value: unknown) => value === null || value === undefined ? null : Math.max(0, Math.floor(Number(value)));
    return { work: work.slice(0, 30), health: { webhook: { failed: count(h.webhook_failed), stale: count(h.webhook_stale) }, email: { retrying: count(h.email_retrying), failed: count(h.email_failed), oldestPendingMinutes: age(h.email_oldest) }, telegram: { retrying: count(h.telegram_retrying), failed: count(h.telegram_failed), oldestPendingMinutes: age(h.telegram_oldest), connection: String(h.telegram_connection ?? 'not_configured') } }, checkedAt: new Date().toISOString() };
  }

  async audit(pageInput = 1, entityType?: string) {
    const page = Number.isSafeInteger(pageInput) && pageInput > 0 ? Math.min(pageInput, 10000) : 1;
    const rows = await db.execute(sql`select a.id, a.actor_user_id as "actorUserId", u.display_name as "actorName", a.tenant_id as "tenantId",
      a.entity_type as "entityType", a.entity_id as "entityId", a.action, a."before", a."after", a.reason, a.occurred_at as "occurredAt"
      from (
        select id, actor_user_id, tenant_id, entity_type, entity_id, action, "before", "after", reason, occurred_at from platform_admin_audit_events
        union all
        select r.id, r.initiated_by, o.tenant_id, 'billing', r.order_id::text, 'billing.reconciled',
          null::jsonb, jsonb_build_object('outcome', r.outcome), null::text, r.requested_at
          from payment_reconciliations r join billing_orders o on o.id = r.order_id
        union all
        select f.id, f.initiated_by, o.tenant_id, 'billing', f.order_id::text, 'billing.refund_requested',
          null::jsonb, jsonb_build_object('status', f.status, 'amountVnd', f.amount_vnd), f.reason, f.requested_at
          from payment_refund_requests f join billing_orders o on o.id = f.order_id
      ) a join users u on u.id = a.actor_user_id
      where (${entityType ?? null}::text is null or a.entity_type = ${entityType ?? null}::text)
      order by a.occurred_at desc, a.id desc limit 30 offset ${(page - 1) * 30}`);
    return { page, items: (rows as Record<string, unknown>[]).map((row) => ({ ...row, occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt) })) };
  }
}
