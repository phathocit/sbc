'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import type { SupportTicketCategory, SupportTicketDto, TenantContextDto } from '@sbc/contracts';
import { api } from '@/lib/api';
import { formatWorkspaceDate } from '@/lib/workspace-date';

const categoryLabels: Record<SupportTicketCategory, string> = { billing: 'Thanh toán', account: 'Tài khoản', booking: 'Lịch hẹn', technical: 'Lỗi kỹ thuật', other: 'Khác' };
const statusLabels = { waiting_admin: 'Chờ ZenBook', waiting_tenant: 'Chờ tiệm', resolved: 'Đã giải quyết', closed: 'Đã đóng' } as const;
const formatDate = (value: string) => formatWorkspaceDate(value, { includeTime: true });

export default function WorkspaceSupportPage() {
  const query = useSearchParams();
  const orderIdFromUrl = query.get('orderId') ?? '';
  const [tenantId, setTenantId] = useState('');
  const [context, setContext] = useState<TenantContextDto | null>(null);
  const [tickets, setTickets] = useState<SupportTicketDto[]>([]);
  const [selected, setSelected] = useState<SupportTicketDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [subject, setSubject] = useState(orderIdFromUrl ? `Hỗ trợ thanh toán · ${orderIdFromUrl}` : '');
  const [category, setCategory] = useState<SupportTicketCategory>(orderIdFromUrl ? 'billing' : 'technical');
  const [billingOrderId, setBillingOrderId] = useState(orderIdFromUrl);
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');

  const refresh = useCallback(async (activeTenantId: string) => {
    const rows = await api.listSupportTickets(activeTenantId);
    setTickets(rows);
    if (selected) {
      const current = rows.find((row) => row.id === selected.id);
      if (current) setSelected(await api.getSupportTicket(activeTenantId, current.id));
      else setSelected(null);
    }
  }, [selected]);

  useEffect(() => {
    const activeTenantId = localStorage.getItem('sbc_tenant_id');
    if (!activeTenantId) { setError('Vui lòng đăng nhập vào workspace của tiệm.'); setLoading(false); return; }
    setTenantId(activeTenantId);
    void Promise.all([api.getCurrentTenant(activeTenantId), api.listSupportTickets(activeTenantId)])
      .then(([tenant, rows]) => {
        setContext(tenant); setTickets(rows);
        if (orderIdFromUrl) {
          setSubject(`Hỗ trợ thanh toán · ${orderIdFromUrl}`); setCategory('billing'); setBillingOrderId(orderIdFromUrl);
        }
      }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Không tải được yêu cầu hỗ trợ.'))
      .finally(() => setLoading(false));
  // Initial load intentionally follows the active tenant and the billing link context.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderIdFromUrl]);

  async function createTicket(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const ticket = await api.createSupportTicket(tenantId, { subject, category, message, billingOrderId: billingOrderId.trim() || null });
      setTickets((current) => [ticket, ...current]); setSelected(ticket); setSubject(''); setMessage(''); setBillingOrderId('');
      setNotice('Đã gửi yêu cầu. ZenBook sẽ phản hồi trong ticket này.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không gửi được yêu cầu.'); }
    finally { setBusy(false); }
  }

  async function openTicket(ticketId: string) {
    setError('');
    try { setSelected(await api.getSupportTicket(tenantId, ticketId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không mở được ticket.'); }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError('');
    try {
      const updated = await api.replySupportTicket(tenantId, selected.id, { message: reply });
      setSelected(updated); setTickets((current) => [updated, ...current.filter((row) => row.id !== updated.id)]); setReply('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không gửi được phản hồi.'); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="owner-page"><div className="app-container"><p className="notice">Đang tải hỗ trợ…</p></div></main>;
  if (context && context.role !== 'owner' && context.role !== 'admin') return <main className="owner-page"><div className="app-container"><p className="notice">Chỉ chủ tiệm hoặc quản trị viên tiệm mới có thể gửi yêu cầu hỗ trợ.</p></div></main>;

  return <main className="owner-page owner-support-page"><div className="app-container">
    <header className="owner-page-heading"><h1>Hỗ trợ</h1><p>Gửi yêu cầu cho ZenBook và theo dõi phản hồi tại đây.</p></header>
    {error && <p className="notice notice-error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    <div className="support-workspace-grid">
      <section className="surface-card support-compose">
        <h2 className="surface-card-title">Gửi yêu cầu hỗ trợ</h2>
        <p className="surface-card-description">ZenBook sẽ phản hồi theo lượt trong ticket này. Bạn có thể trả lời tiếp tại cùng một nơi.</p>
        <form className="support-form" onSubmit={createTicket}>
          <label>Chủ đề<select value={category} onChange={(event) => setCategory(event.target.value as SupportTicketCategory)}><option value="billing">Thanh toán</option><option value="account">Tài khoản</option><option value="booking">Lịch hẹn</option><option value="technical">Lỗi kỹ thuật</option><option value="other">Khác</option></select></label>
          <label>Tiêu đề<input required minLength={4} maxLength={140} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Tóm tắt vấn đề" /></label>
          <label>Mã đơn thanh toán <span>(không bắt buộc)</span><input value={billingOrderId} onChange={(event) => setBillingOrderId(event.target.value)} placeholder="Tự điền khi mở từ Billing" /></label>
          <label>Nội dung<textarea required minLength={8} maxLength={5000} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Mô tả vấn đề và điều bạn cần hỗ trợ" /></label>
          <button className="button button-primary" type="submit" disabled={busy || !tenantId}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu'}</button>
        </form>
      </section>
      <section className="surface-card support-inbox">
        <header className="support-section-heading"><div><h2 className="surface-card-title">Yêu cầu của {context?.tenant.displayName ?? 'tiệm'}</h2><p className="surface-card-description">{tickets.length} ticket gần đây</p></div><button type="button" className="button button-secondary" disabled={loading} onClick={() => void refresh(tenantId)}>Làm mới</button></header>
        {tickets.length === 0 ? <p className="support-empty">Chưa có yêu cầu. Dùng biểu mẫu bên trái để gửi ticket đầu tiên.</p> : <div className="support-ticket-list">{tickets.map((ticket) => <button type="button" key={ticket.id} className={`support-ticket-item${selected?.id === ticket.id ? ' is-selected' : ''}`} onClick={() => void openTicket(ticket.id)}><span className="support-ticket-title">{ticket.subject}</span><span className="support-ticket-meta">{categoryLabels[ticket.category]} · {formatDate(ticket.updatedAt)}</span><span className={`support-ticket-status is-${ticket.status}`}>{statusLabels[ticket.status]}</span></button>)}</div>}
        {selected && <div className="support-thread"><header><div><h3>{selected.subject}</h3><p>{categoryLabels[selected.category]} · Mở {formatDate(selected.createdAt)}</p>{selected.billingOrderId && <code>Đơn: {selected.billingOrderId}</code>}</div><span className={`support-ticket-status is-${selected.status}`}>{statusLabels[selected.status]}</span></header>
          <div className="support-thread-messages">{(selected.messages ?? []).map((item) => <article className={`support-message is-${item.senderRole}`} key={item.id}><div><strong>{item.senderRole === 'platform_admin' ? 'ZenBook' : item.senderName}</strong><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></div><p>{item.message}</p></article>)}</div>
          {selected.status === 'closed' ? <p className="support-empty">Ticket đã đóng. Tạo yêu cầu mới nếu cần trợ giúp thêm.</p> : selected.status === 'waiting_admin' ? <p className="support-turn-note">Yêu cầu đã gửi. Đang chờ ZenBook phản hồi; bạn có thể trả lời tiếp sau khi nhận được phản hồi.</p> : <form className="support-reply-form" onSubmit={sendReply}><label htmlFor="support-reply">Phản hồi</label><textarea id="support-reply" required maxLength={5000} rows={3} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Viết phản hồi cho ZenBook" /><button className="button button-secondary" type="submit" disabled={busy || !reply.trim()}>{busy ? 'Đang gửi…' : 'Gửi phản hồi'}</button></form>}
        </div>}
      </section>
    </div>
  </div></main>;
}
