'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { TenantNotificationDto, TenantNotificationPageDto } from '@sbc/contracts';
import { api } from '@/lib/api';
import { formatWorkspaceDate } from '@/lib/workspace-date';

export default function TenantNotificationsPage() {
  const [tenantId, setTenantId] = useState('');
  const [items, setItems] = useState<TenantNotificationDto[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (id: string, nextPage = 1) => {
    try {
      const result: TenantNotificationPageDto = await api.listTenantNotifications(id, nextPage);
      setItems((current) => nextPage === 1 ? result.items : [...current, ...result.items.filter((item) => !current.some((row) => row.id === item.id))]);
      setUnreadCount(result.unreadCount);
      setHasMore(result.hasMore);
      setPage(nextPage);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải thông báo.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const id = localStorage.getItem('sbc_tenant_id');
    if (!id) { setError('Hãy chọn tiệm trước khi xem thông báo.'); setLoading(false); return; }
    setTenantId(id);
    void load(id);
    const stop = api.connectTenantNotificationStream(id, () => void load(id));
    return stop;
  }, [load]);

  const markRead = async (item: TenantNotificationDto) => {
    if (item.isRead || !tenantId) return;
    setBusyId(item.id);
    try {
      await api.markTenantNotificationRead(tenantId, item.id);
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, isRead: true } : row));
      setUnreadCount((count) => Math.max(0, count - 1));
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể đánh dấu đã đọc.'); }
    finally { setBusyId(''); }
  };

  return <main className="owner-notifications surface-card">
    <header className="owner-notifications-header"><div><h1>Thông báo</h1><p>Các cập nhật lịch hẹn và thanh toán của tiệm.</p></div><span className="owner-notifications-count">{unreadCount} chưa đọc</span></header>
    {error && <p className="owner-notifications-error" role="alert">{error} <button type="button" onClick={() => tenantId && void load(tenantId)}>Thử lại</button></p>}
    {loading ? <p role="status">Đang tải thông báo…</p> : items.length === 0 ? <div className="owner-notifications-empty">Chưa có thông báo nào.</div> : <div className="owner-notifications-list">{items.map((item) => <article key={item.id} className={`owner-notification${item.isRead ? '' : ' is-unread'}`}>
      <div className="owner-notification-body"><div className="owner-notification-meta"><span>{item.type.startsWith('booking_') ? 'Lịch hẹn' : 'Thanh toán'}</span><time dateTime={item.occurredAt}>{formatWorkspaceDate(item.occurredAt, { includeTime: true })}</time></div><h2>{item.title}</h2><p>{item.description}</p></div>
      <div className="owner-notification-actions">{!item.isRead && <button type="button" className="button button-secondary" disabled={busyId === item.id} onClick={() => void markRead(item)}>Đánh dấu đã đọc</button>}<Link className="button button-primary" href={item.actionPath.startsWith('/workspace/') ? item.actionPath : '/workspace'} onClick={() => void markRead(item)}>Xem chi tiết</Link></div>
    </article>)}{hasMore && <button type="button" className="button button-secondary owner-notifications-more" onClick={() => tenantId && void load(tenantId, page + 1)}>Xem thêm</button>}</div>}
  </main>;
}
