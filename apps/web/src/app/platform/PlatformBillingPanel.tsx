'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  PlatformBillingFilters, PlatformBillingOrderDto, PlatformBillingOrderPageDto,
  PlatformBillingSubscriptionDto, PlatformBillingSubscriptionPageDto, PlatformBillingSummaryDto, PlatformPlanDto,
} from '@sbc/contracts';
import { api } from '@/lib/api';

type BillingView = 'subscriptions' | 'orders';
const emptySummary: PlatformBillingSummaryDto = {
  activeSubscriptions: 0, pastDueSubscriptions: 0, expiredSubscriptions: 0,
  pendingOrders: 0, stalePendingOrders: 0, failedOrders: 0, expiredOrders: 0,
  paidReviewOrders: 0, refundPendingOrders: 0, refundedOrders: 0, refundedTotalVnd: '0',
  paidOrders: 0, paidTotalVnd: '0', paidOrdersThisMonth: 0, paidTotalThisMonthVnd: '0',
  revenueFrom: '', revenueTo: '', revenueGranularity: 'day', revenueSeries: [], tenantPlanDistribution: [],
};

function formatVnd(value: number | string): string {
  return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} đ`;
}

function dateLabel(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function subscriptionStatus(status: PlatformBillingSubscriptionDto['status']): string {
  return status === 'active' ? 'Đang hoạt động' : status === 'past_due' ? 'Quá hạn thanh toán' : 'Hết kỳ';
}

function orderStatus(order: PlatformBillingOrderDto): string {
  if (order.status === 'pending' && Date.parse(order.expiresAt) <= Date.now()) return 'Chờ xử lý · đã quá hạn';
  return ({ pending: 'Đang chờ', paid: 'Đã thanh toán', paid_review: 'Đã thu · cần xử lý', failed: 'Thất bại', expired: 'Hết hạn', cancelled: 'Đã hủy', refunded: 'Đã hoàn tiền' } as const)[order.status];
}

export default function PlatformBillingPanel({ plans, view, onViewChange, onOpenTenant }: { plans: PlatformPlanDto[]; view: BillingView; onViewChange: (view: BillingView) => void; onOpenTenant: (tenantId: string) => void }) {
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState<PlatformBillingFilters>({ page: 1, pageSize: 20 });
  const [summary, setSummary] = useState<PlatformBillingSummaryDto>(emptySummary);
  const [subscriptions, setSubscriptions] = useState<PlatformBillingSubscriptionPageDto | null>(null);
  const [orders, setOrders] = useState<PlatformBillingOrderPageDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [reconcilingOrderId, setReconcilingOrderId] = useState('');
  const [reconciliationMessage, setReconciliationMessage] = useState('');
  const [actionOrder, setActionOrder] = useState<PlatformBillingOrderDto | null>(null);
  const [actionMode, setActionMode] = useState<'refund' | 'apply' | 'refund-reconcile' | null>(null);
  const [actionPassword, setActionPassword] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void (async () => {
      try {
        const summaryRequest = api.getPlatformBillingSummary();
        const pageRequest = view === 'subscriptions'
          ? api.listPlatformBillingSubscriptions(filters)
          : api.listPlatformBillingOrders(filters);
        const [summaryResult, pageResult] = await Promise.all([summaryRequest, pageRequest]);
        if (!active) return;
        setSummary(summaryResult);
        if (view === 'subscriptions') setSubscriptions(pageResult as PlatformBillingSubscriptionPageDto);
        else setOrders(pageResult as PlatformBillingOrderPageDto);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Không tải được dữ liệu billing.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [view, filters, reloadKey]);

  const planCodes = useMemo(() => [...new Set(plans.map((plan) => plan.code))], [plans]);
  const total = view === 'subscriptions' ? subscriptions?.total ?? 0 : orders?.total ?? 0;
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFilters({
      search: searchText.trim() || undefined, status: statusFilter || undefined,
      provider: view === 'orders' && providerFilter ? providerFilter as PlatformBillingFilters['provider'] : undefined,
      planCode: planFilter || undefined, from: view === 'orders' ? from || undefined : undefined,
      to: view === 'orders' ? to || undefined : undefined, page: 1, pageSize: 20,
    });
  };

  const switchView = (next: BillingView) => {
    if (next === view) return;
    setStatusFilter(''); setProviderFilter(''); setPlanFilter(''); setFrom(''); setTo('');
    setFilters({ search: searchText.trim() || undefined, page: 1, pageSize: 20 });
    onViewChange(next);
  };

  const changePage = (next: number) => setFilters((current) => ({ ...current, page: Math.min(pages, Math.max(1, next)) }));

  async function reconcile(orderId: string) {
    setReconcilingOrderId(orderId); setReconciliationMessage(''); setError('');
    try {
      const result = await api.reconcilePlatformBillingOrder(orderId);
      setReconciliationMessage(result.message);
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không đối soát được giao dịch.');
    } finally { setReconcilingOrderId(''); }
  }

  function openAction(order: PlatformBillingOrderDto, mode: 'refund' | 'apply' | 'refund-reconcile') {
    setActionOrder(order); setActionMode(mode); setActionPassword(''); setActionReason(''); setError('');
  }

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actionOrder || !actionMode || actionBusy || !actionPassword) return;
    setActionBusy(true); setError(''); setReconciliationMessage('');
    try {
      if (actionMode === 'refund') {
        if (actionReason.trim().length < 3) throw new Error('Nhập lý do hoàn tiền từ 3 ký tự.');
        if (!window.confirm(`Xác nhận gửi yêu cầu hoàn toàn bộ ${formatVnd(actionOrder.amountVnd)} cho giao dịch này?`)) return;
        const result = await api.refundPlatformBillingOrder(actionOrder.id, { currentPassword: actionPassword, reason: actionReason.trim() });
        setReconciliationMessage(result.message);
      } else if (actionMode === 'apply') {
        if (actionReason.trim().length < 3) throw new Error('Nhập ghi chú xử lý từ 3 ký tự.');
        await api.applyPlatformLatePayment(actionOrder.id, { currentPassword: actionPassword, note: actionReason.trim() });
        setReconciliationMessage('Đã áp dụng gói cho khoản thanh toán đã được đối soát.');
      } else {
        if (!actionOrder.refund) throw new Error('Không có yêu cầu hoàn tiền để đối soát.');
        const result = await api.reconcilePlatformBillingRefund(actionOrder.id, actionOrder.refund.id, { currentPassword: actionPassword });
        setReconciliationMessage(result.message);
      }
      setActionOrder(null); setActionMode(null); setActionPassword(''); setActionReason('');
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không hoàn tất được thao tác billing.');
    } finally { setActionBusy(false); }
  }

  return <section className="platform-billing-panel" aria-label="Quản lý billing tenant">
    <div className="platform-billing-summary" aria-label="Tổng hợp billing">
      <article><span>GÓI ĐANG HOẠT ĐỘNG</span><strong>{summary.activeSubscriptions}</strong><small>{summary.pastDueSubscriptions} quá hạn · {summary.expiredSubscriptions} hết kỳ</small></article>
      <article><span>ĐƠN ĐANG CHỜ</span><strong>{summary.pendingOrders}</strong><small>{summary.stalePendingOrders} đơn đã quá hạn · {summary.paidReviewOrders} khoản đã thu cần xử lý</small></article>
      <article><span>ĐƠN LỖI / HẾT HẠN</span><strong>{summary.failedOrders + summary.expiredOrders}</strong><small>{summary.failedOrders} thất bại · {summary.expiredOrders} hết hạn</small></article>
      <article><span>ĐÃ THANH TOÁN THÁNG NÀY</span><strong>{formatVnd(summary.paidTotalThisMonthVnd)}</strong><small>{summary.paidOrdersThisMonth} đơn · {summary.refundedOrders} đơn đã hoàn · {summary.refundPendingOrders} yêu cầu đang xử lý</small></article>
    </div>

    <div className="platform-billing-view-tabs" role="tablist" aria-label="Dữ liệu billing">
      <button type="button" role="tab" aria-selected={view === 'subscriptions'} className={view === 'subscriptions' ? 'is-active' : ''} onClick={() => switchView('subscriptions')}>Gói thuê bao</button>
      <button type="button" role="tab" aria-selected={view === 'orders'} className={view === 'orders' ? 'is-active' : ''} onClick={() => switchView('orders')}>Đơn thanh toán</button>
    </div>

    <form className="platform-list-toolbar platform-billing-filters" onSubmit={applyFilters}>
      <label className="platform-search"><span className="sr-only">Tìm doanh nghiệp hoặc chủ tiệm</span><span className="platform-search-control"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6"/><path d="m16 16 4.5 4.5"/></svg><input aria-label="Tìm doanh nghiệp hoặc chủ tiệm" value={searchText} maxLength={120} onChange={(event) => setSearchText(event.target.value)} placeholder="Tên tiệm, slug, email chủ tiệm" /></span></label>
      <label className="platform-filter"><span className="sr-only">Gói dịch vụ</span><select aria-label="Lọc theo gói dịch vụ" value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}><option value="">Mọi gói</option>{planCodes.map((code) => <option key={code} value={code}>{plans.find((plan) => plan.code === code)?.displayName ?? code}</option>)}</select></label>
      <label className="platform-filter"><span className="sr-only">Trạng thái</span><select aria-label="Lọc theo trạng thái" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
        <option value="">Mọi trạng thái</option>
        {view === 'subscriptions' ? <><option value="active">Đang hoạt động</option><option value="past_due">Quá hạn thanh toán</option><option value="expired">Hết kỳ</option></> : <><option value="pending">Đang chờ</option><option value="paid">Đã thanh toán</option><option value="paid_review">Đã thu · cần xử lý</option><option value="failed">Thất bại</option><option value="expired">Hết hạn</option><option value="cancelled">Đã hủy</option><option value="refunded">Đã hoàn tiền</option></>}
      </select></label>
      {view === 'orders' && <>
        <label className="platform-filter"><span className="sr-only">Cổng thanh toán</span><select aria-label="Lọc theo cổng thanh toán" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}><option value="">Mọi cổng</option><option value="vnpay">VNPAY</option><option value="momo">MoMo</option></select></label>
        <label className="platform-billing-date"><span className="sr-only">Từ ngày</span><input aria-label="Từ ngày" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="platform-billing-date"><span className="sr-only">Đến ngày</span><input aria-label="Đến ngày" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </>}
      <button type="submit" className="button button-secondary">Áp dụng</button>
      <button type="button" className="platform-refresh-button is-icon-only" aria-label="Làm mới billing" title="Làm mới" disabled={loading} onClick={() => setReloadKey((key) => key + 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7 7 0 0 1 11.8-2L20 12M4 12l2.7 5a7 7 0 0 0 11.8-2"/></svg></button>
    </form>

    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {reconciliationMessage && <p className="notice" role="status">{reconciliationMessage}</p>}
    {actionOrder && actionMode && <form className="surface-card platform-billing-action" onSubmit={submitAction}>
      <div><p className="eyebrow">{actionMode === 'refund' ? 'HOÀN TIỀN TOÀN PHẦN' : actionMode === 'apply' ? 'XỬ LÝ KHOẢN ĐÃ THU' : 'ĐỐI SOÁT HOÀN TIỀN'}</p>
        <h3>{actionOrder.tenantName} · {formatVnd(actionOrder.amountVnd)}</h3>
        <p className="surface-card-description">{actionMode === 'refund' ? 'Chỉ tạo yêu cầu hoàn toàn bộ. Quyền lợi còn hiệu lực sẽ không bị thu hồi tự động; hệ thống chặn hoàn tiền khi gói từ giao dịch này vẫn đang hoạt động.' : actionMode === 'apply' ? 'Chỉ áp dụng sau khi xác nhận lại mật khẩu và ghi chú quản trị. Hệ thống chặn nếu đã có giao dịch mới hơn hoặc yêu cầu hoàn tiền.' : 'Truy vấn trạng thái yêu cầu hiện tại. Nếu cổng chưa có kết quả cuối cùng, đơn sẽ tiếp tục ở trạng thái cần theo dõi.'}</p>
      </div>
      {actionMode !== 'refund-reconcile' && <label>{actionMode === 'refund' ? 'Lý do hoàn tiền' : 'Ghi chú xử lý'}<textarea value={actionReason} maxLength={500} required minLength={3} onChange={(event) => setActionReason(event.target.value)} /></label>}
      <label>Mật khẩu quản trị hiện tại<input type="password" autoComplete="current-password" value={actionPassword} required onChange={(event) => setActionPassword(event.target.value)} /></label>
      <div className="platform-billing-action-buttons"><button type="submit" className="button button-primary" disabled={actionBusy}>{actionBusy ? 'Đang xử lý…' : actionMode === 'refund' ? 'Gửi yêu cầu hoàn tiền' : actionMode === 'apply' ? 'Áp dụng gói' : 'Đối soát yêu cầu'}</button><button type="button" className="button button-secondary" disabled={actionBusy} onClick={() => { setActionOrder(null); setActionMode(null); }}>Đóng</button></div>
    </form>}
    {loading ? <div className="platform-empty-state" role="status">Đang tải dữ liệu billing…</div> : view === 'subscriptions' ? <div className="platform-billing-table-wrap platform-tenant-table-wrap"><table className="platform-billing-table platform-tenant-table"><thead><tr><th>Tenant / chủ tiệm</th><th>Gói</th><th>Trạng thái</th><th>Kỳ sử dụng</th><th>Sử dụng kỳ hiện tại</th></tr></thead><tbody>
      {(subscriptions?.items ?? []).map((item) => <tr key={item.tenantId}><td><button type="button" className="platform-tenant-detail-link" onClick={() => onOpenTenant(item.tenantId)}>{item.tenantName}</button><small>/{item.tenantSlug} · {item.tenantStatus === 'active' ? 'Tenant hoạt động' : 'Tenant tạm ngưng'}</small><small>{item.ownerName || 'Chưa có owner'} · {item.ownerEmail || 'Chưa có email'}</small></td><td><strong>{item.planName}</strong><small>{item.planCode} · phiên bản {item.planVersion}</small><small>{formatVnd(item.priceVnd)}/tháng</small></td><td><span className={`platform-billing-status is-${item.status}`}>{subscriptionStatus(item.status)}</span></td><td><small>Từ {dateLabel(item.periodStart)}</small><small>Đến {dateLabel(item.periodEnd)}</small></td><td><small>{item.activeStaff} / {item.staffLimit} hồ sơ nhân viên đang hoạt động</small><small>{item.bookings} / {item.bookingLimit === null ? 'Không giới hạn' : item.bookingLimit} lịch đã ghi nhận</small></td></tr>)}
      {subscriptions?.items.length === 0 && <tr><td colSpan={5} className="platform-billing-empty">Không có gói thuê bao phù hợp.</td></tr>}
    </tbody></table></div> : <div className="platform-billing-table-wrap platform-tenant-table-wrap"><table className="platform-billing-table platform-tenant-table platform-billing-orders"><thead><tr><th>Tenant / chủ tiệm</th><th>Gói</th><th>Đơn hàng</th><th>Giao dịch</th><th>Ngày tạo / thanh toán</th><th>Đối soát</th></tr></thead><tbody>
      {(orders?.items ?? []).map((item) => {
        const canReconcile = !['paid', 'cancelled', 'refunded'].includes(item.status) && (item.status !== 'pending' || Date.parse(item.expiresAt) <= Date.now());
        const refundOpen = item.refund && ['started', 'pending', 'unknown'].includes(item.refund.status);
        return <tr key={item.id}><td><button type="button" className="platform-tenant-detail-link" onClick={() => onOpenTenant(item.tenantId)}>{item.tenantName}</button><small>/{item.tenantSlug}</small><small>{item.ownerName || 'Chưa có owner'} · {item.ownerEmail || 'Chưa có email'}</small></td><td><strong>{item.planName}</strong><small>{item.planCode} · phiên bản {item.planVersion}</small></td><td><strong>{formatVnd(item.amountVnd)}</strong><small>{item.provider.toUpperCase()} · {orderStatus(item)}</small><small>{item.id}</small></td><td><small>Lần thử: {item.attempt?.status ?? 'Chưa có'}</small><small>Mã giao dịch: {item.attempt?.transactionReference ?? 'Chưa có'}</small><small>Webhook: {item.webhook ? `${item.webhook.signatureVerified ? 'Đã xác minh chữ ký' : 'Chưa xác minh'} · ${item.webhook.status}` : 'Chưa nhận'}</small>{item.refund && <small>Hoàn {formatVnd(item.refund.amountVnd)} · {item.refund.status} · {item.refund.reason}</small>}</td><td><small>Tạo: {dateLabel(item.createdAt)}</small><small>Trả: {dateLabel(item.paidAt)}</small><small>Hạn: {dateLabel(item.expiresAt)}</small></td><td className="platform-billing-actions">
          {canReconcile && <button type="button" className="button button-secondary" disabled={Boolean(reconcilingOrderId)} onClick={() => void reconcile(item.id)}>{reconcilingOrderId === item.id ? 'Đang đối soát…' : `Đối soát ${item.provider.toUpperCase()}`}</button>}
          {item.status === 'paid_review' && <button type="button" className="button button-secondary" onClick={() => openAction(item, 'apply')}>Áp dụng gói đã thu</button>}
          {refundOpen ? <button type="button" className="button button-secondary" onClick={() => openAction(item, 'refund-reconcile')}>Đối soát hoàn tiền</button> : ['paid', 'paid_review'].includes(item.status) && item.refund?.status !== 'succeeded' && <button type="button" className="button button-danger-soft" onClick={() => openAction(item, 'refund')}>Hoàn tiền</button>}
        </td></tr>;
      })}
      {orders?.items.length === 0 && <tr><td colSpan={6} className="platform-billing-empty">Không có đơn thanh toán phù hợp.</td></tr>}
    </tbody></table></div>}

    <footer className="platform-billing-pagination"><span>{total === 0 ? 'Chưa có bản ghi' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} / ${total}`}</span><div><button type="button" className="button button-secondary" disabled={loading || page <= 1} onClick={() => changePage(page - 1)}>Trước</button><span>Trang {page} / {pages}</span><button type="button" className="button button-secondary" disabled={loading || page >= pages} onClick={() => changePage(page + 1)}>Sau</button></div></footer>
  </section>;
}
