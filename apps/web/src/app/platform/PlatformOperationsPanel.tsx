'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Overview = Awaited<ReturnType<typeof api.getPlatformOperations>>;
type Audit = Awaited<ReturnType<typeof api.getPlatformAudit>>;
type WorkItem = Overview['work'][number];

const actionLabels: Record<string, string> = {
  'application.approved': 'Duyệt hồ sơ', 'application.rejected': 'Từ chối hồ sơ',
  'tenant.status_changed': 'Đổi trạng thái tenant', 'tenant.invitation_resent': 'Gửi lại lời mời',
  'plan.version_created': 'Tạo phiên bản gói', 'plan.archived': 'Ngừng bán gói', 'plan.support_grant': 'Gán gói hỗ trợ',
  'billing.reconciled': 'Đối soát thanh toán', 'billing.refund_requested': 'Yêu cầu hoàn tiền',
  'billing.late_payment_applied': 'Áp dụng thanh toán đến muộn', 'settings.updated': 'Cập nhật cấu hình',
  'telegram.configuration_updated': 'Cập nhật Telegram',
  'support.replied': 'Phản hồi ticket', 'support.status_changed': 'Đổi trạng thái ticket',
  'support.replied_via_telegram': 'Phản hồi ticket qua Telegram',
};
const entityLabels: Record<string, string> = { application: 'Hồ sơ', tenant: 'Tenant', plan: 'Gói', billing: 'Billing', settings: 'Cấu hình', telegram: 'Telegram', support: 'Hỗ trợ' };

function age(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 60) return `${minutes} phút`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} giờ`;
  return `${Math.floor(minutes / 1440)} ngày`;
}

export default function PlatformOperationsPanel({ compact = false, onOpen, onOpenOperations }: {
  compact?: boolean; onOpen: (item: WorkItem) => void; onOpenOperations?: () => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [auditType, setAuditType] = useState('');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    void api.getPlatformOperations().then((value) => { if (active) { setOverview(value); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Không tải được dữ liệu vận hành.'); });
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh]);

  useEffect(() => {
    if (compact) return;
    let active = true;
    void api.getPlatformAudit(auditPage, auditType).then((value) => { if (active) setAudit(value); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Không tải được nhật ký.'); });
    return () => { active = false; };
  }, [compact, auditPage, auditType, refresh]);

  const work = overview?.work ?? [];
  const health = overview?.health;
  return <div className={`platform-operations${compact ? ' is-compact' : ''}`}>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    <section className="platform-operations-section" aria-label="Việc cần xử lý">
      <header className="platform-operations-heading"><div><h2>Việc cần xử lý</h2><small>Ưu tiên việc chờ lâu nhất · cập nhật mỗi phút</small></div>
        {compact ? <button type="button" className="platform-overview-link" onClick={onOpenOperations}>Xem tất cả ›</button> : <button type="button" className="platform-overview-link" onClick={() => setRefresh((value) => value + 1)}>Làm mới</button>}</header>
      <div className="platform-operations-list">
        {work.slice(0, compact ? 4 : 30).map((item) => <button key={`${item.kind}-${item.id}`} type="button" className="platform-operations-item" onClick={() => onOpen(item)}>
          <span className={`platform-operations-indicator is-${item.kind}`} aria-hidden="true" /><span className="platform-operations-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
          <span className="platform-operations-age" title={new Date(item.occurredAt).toLocaleString('vi-VN')}>Chờ {age(item.occurredAt)}</span><span aria-hidden="true">›</span>
        </button>)}
        {overview && work.length === 0 && <p className="platform-operations-empty">Hiện không có việc tồn đọng.</p>}
        {!overview && !error && <p className="platform-operations-empty">Đang tải việc cần xử lý…</p>}
      </div>
    </section>
    {!compact && <>
      <section className="platform-operations-section" aria-label="Sức khỏe tích hợp">
        <header className="platform-operations-heading"><div><h2>Trạng thái vận hành</h2><small>Chỉ phản ánh dữ liệu đã ghi trong hệ thống · {overview ? new Date(overview.checkedAt).toLocaleString('vi-VN') : 'đang tải'}</small></div></header>
        <div className="platform-health-grid">
          <article><strong>Webhook thanh toán</strong><span className={health && (health.webhook.failed || health.webhook.stale) ? 'is-alert' : 'is-good'}>{health ? `${health.webhook.failed} lỗi · ${health.webhook.stale} tồn quá 5 phút` : '—'}</span><small>Giao dịch cần xem tại Billing</small></article>
          <article><strong>Email</strong><span className={health?.email.failed ? 'is-alert' : 'is-good'}>{health ? `${health.email.failed} gửi thất bại · ${health.email.retrying} chờ` : '—'}</span><small>{health?.email.oldestPendingMinutes != null ? `Cũ nhất ${health.email.oldestPendingMinutes} phút` : 'Không có email đang chờ'}</small></article>
          <article><strong>Telegram</strong><span className={health?.telegram.failed || (health && health.telegram.connection === 'failed') ? 'is-alert' : 'is-good'}>{health ? `${health.telegram.failed} gửi thất bại · ${health.telegram.retrying} chờ` : '—'}</span><small>{health ? `Kết nối: ${health.telegram.connection} · ${health.telegram.oldestPendingMinutes != null ? `cũ nhất ${health.telegram.oldestPendingMinutes} phút` : 'không có tin đang chờ'}` : 'Đang tải'}</small></article>
        </div>
      </section>
      <section className="platform-operations-section" aria-label="Nhật ký quản trị">
        <header className="platform-operations-heading"><div><h2>Nhật ký quản trị</h2><small>Người thực hiện, thay đổi và lý do · không chứa thông tin bí mật</small></div>
          <select aria-label="Lọc nhật ký" value={auditType} onChange={(event) => { setAuditType(event.target.value); setAuditPage(1); }}><option value="">Tất cả</option>{Object.entries(entityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></header>
        <div className="platform-audit-list">{audit?.items.map((item) => <article key={item.id} className="platform-audit-item">
          <div><strong>{actionLabels[item.action] ?? item.action}</strong><small>{entityLabels[item.entityType] ?? item.entityType} · {item.entityId.slice(0, 8)}</small>{item.reason && <p>Lý do: {item.reason}</p>}</div>
          <div className="platform-audit-meta"><span>{item.actorName}</span><time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString('vi-VN')}</time></div>
          {(item.before || item.after) && <details><summary>Xem thay đổi</summary><div className="platform-audit-diff"><code>Trước: {JSON.stringify(item.before ?? {})}</code><code>Sau: {JSON.stringify(item.after ?? {})}</code></div></details>}
        </article>)}{audit && audit.items.length === 0 && <p className="platform-operations-empty">Chưa có thao tác phù hợp.</p>}</div>
        <div className="platform-audit-pagination"><button type="button" disabled={auditPage <= 1} onClick={() => setAuditPage((page) => page - 1)}>‹ Trước</button><span>Trang {auditPage}</span><button type="button" disabled={!audit || audit.items.length < 30} onClick={() => setAuditPage((page) => page + 1)}>Sau ›</button></div>
      </section>
    </>}
  </div>;
}
