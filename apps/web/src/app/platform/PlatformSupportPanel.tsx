'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { SupportTicketDto, SupportTicketStatus } from '@sbc/contracts';
import { api } from '@/lib/api';

const statuses: Record<SupportTicketStatus, string> = { waiting_admin: 'Chờ ZenBook', waiting_tenant: 'Chờ tenant', resolved: 'Đã giải quyết', closed: 'Đã đóng' };
const categories = { billing: 'Thanh toán', account: 'Tài khoản', booking: 'Lịch hẹn', technical: 'Lỗi kỹ thuật', other: 'Khác' } as const;
const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export default function PlatformSupportPanel() {
  const [tickets, setTickets] = useState<SupportTicketDto[]>([]);
  const [selected, setSelected] = useState<SupportTicketDto | null>(null);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load(selectedId = selected?.id) {
    setLoading(true); setError('');
    try {
      const rows = await api.listPlatformSupportTickets(status, search);
      setTickets(rows);
      if (selectedId && rows.some((row) => row.id === selectedId)) setSelected(await api.getPlatformSupportTicket(selectedId));
      else { setSelected(null); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tải được yêu cầu hỗ trợ.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 250);
    return () => window.clearTimeout(timer);
  // load() intentionally refreshes when the filters change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search]);

  async function openTicket(id: string) {
    setError('');
    try { setSelected(await api.getPlatformSupportTicket(id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không mở được ticket.'); }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = await api.replyPlatformSupportTicket(selected.id, { message: reply });
      setSelected(updated); setReply(''); setNotice('Đã gửi phản hồi cho tenant.'); await load(updated.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không gửi được phản hồi.'); }
    finally { setBusy(false); }
  }

  async function updateStatus(nextStatus: SupportTicketStatus) {
    if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try { const updated = await api.updatePlatformSupportTicket(selected.id, { status: nextStatus }); setSelected(updated); setNotice(`Đã chuyển trạng thái: ${statuses[nextStatus]}.`); await load(updated.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không cập nhật được trạng thái.'); }
    finally { setBusy(false); }
  }

  return <section className="platform-support-panel">
    <header className="platform-support-toolbar"><div><h2>Yêu cầu hỗ trợ</h2><p>Trao đổi theo ticket với chủ tiệm và theo dõi trạng thái xử lý.</p></div><button className="platform-refresh-button is-icon-only" type="button" aria-label="Làm mới ticket" title="Làm mới" disabled={loading} onClick={() => void load()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7 7 0 0 1 11.8-2L20 12M4 12l2.7 5a7 7 0 0 0 11.8-2"/></svg></button></header>
    {error && <p className="notice notice-error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    <div className="platform-support-filters"><input aria-label="Tìm ticket" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo tenant hoặc tiêu đề" /><select aria-label="Lọc trạng thái ticket" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Tất cả trạng thái</option><option value="waiting_admin">Chờ ZenBook</option><option value="waiting_tenant">Chờ tenant</option><option value="resolved">Đã giải quyết</option><option value="closed">Đã đóng</option></select></div>
    <div className="platform-support-grid">
      <div className="platform-support-list" aria-label="Danh sách ticket">
        {loading && tickets.length === 0 ? <p className="platform-support-empty">Đang tải ticket…</p> : tickets.length === 0 ? <p className="platform-support-empty">Không có ticket phù hợp.</p> : tickets.map((ticket) => <button type="button" key={ticket.id} className={`platform-support-ticket${selected?.id === ticket.id ? ' is-selected' : ''}`} onClick={() => void openTicket(ticket.id)}><span className="platform-support-ticket-top"><strong>{ticket.subject}</strong><i className={`support-ticket-status is-${ticket.status}`}>{statuses[ticket.status]}</i></span><span>{ticket.tenantName} · /{ticket.tenantSlug}</span><small>{categories[ticket.category]} · {dateTime(ticket.updatedAt)}</small></button>)}
      </div>
      {selected ? <article className="platform-support-thread"><header><div><h3>{selected.subject}</h3><p>{selected.tenantName} · /{selected.tenantSlug} · {categories[selected.category]}</p>{selected.billingOrderId && <code>Đơn thanh toán: {selected.billingOrderId}</code>}</div><select aria-label="Trạng thái ticket" value={selected.status} disabled={busy} onChange={(event) => void updateStatus(event.target.value as SupportTicketStatus)}>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key} disabled={key === 'waiting_tenant'}>{label}{key === 'waiting_tenant' ? ' · tự động sau phản hồi' : ''}</option>)}</select></header>
        <div className="platform-support-messages">{(selected.messages ?? []).map((message) => <article key={message.id} className={`support-message is-${message.senderRole}`}><div><strong>{message.senderRole === 'platform_admin' ? `ZenBook · ${message.senderName}` : message.senderName}</strong><time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time></div><p>{message.message}</p></article>)}</div>
        {selected.status === 'waiting_admin' ? <form className="platform-support-reply" onSubmit={sendReply}><label htmlFor="platform-support-reply">Phản hồi tenant</label><textarea id="platform-support-reply" required maxLength={5000} rows={4} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Viết phản hồi rõ ràng, kèm hướng xử lý nếu có" /><button className="button button-primary" type="submit" disabled={busy || !reply.trim()}>{busy ? 'Đang gửi…' : 'Gửi phản hồi'}</button></form> : <p className="platform-support-empty">{selected.status === 'waiting_tenant' ? 'Đã gửi phản hồi. Đang chờ tenant trả lời.' : selected.status === 'resolved' ? 'Ticket đã được đánh dấu giải quyết.' : 'Ticket đã đóng.'}</p>}
      </article> : <div className="platform-support-empty platform-support-thread-empty">Chọn một ticket để xem trao đổi và phản hồi.</div>}
    </div>
  </section>;
}
