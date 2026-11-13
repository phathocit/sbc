'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlatformBillingOrderDto, PlatformBillingSummaryDto, PlatformNotificationDto, PlatformPlanDto, PlatformTenantDetailDto, PlatformTenantDto, TenantApplicationDto } from '@sbc/contracts';
import { api } from '@/lib/api';
import { usePlatformTheme } from './use-platform-theme';
import PlatformSettingsPanel from './settings/PlatformSettingsPanel';
import PlatformPlansPanel from './PlatformPlansPanel';
import PlatformBillingPanel from './PlatformBillingPanel';
import PlatformSupportPanel from './PlatformSupportPanel';

type AccessState = 'loading' | 'login' | 'admin' | 'bootstrap' | 'denied' | 'bootstrap-unavailable';
type ConsoleTab = 'overview' | 'applications' | 'tenants' | 'notifications' | 'billing' | 'plans' | 'support' | 'settings';
type BillingView = 'subscriptions' | 'orders';
type OverviewPeriodMode = 'day' | '7d' | '30d' | 'custom';
type NotificationFilter = 'all' | PlatformNotificationDto['type'];
type NotificationReadFilter = 'all' | 'unread' | 'read';

function formatCompactVnd(value: number): string {
  return new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function vietnamDateString(date = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateOnlyLabel(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function periodLabel(value: string, granularity: PlatformBillingSummaryDto['revenueGranularity']): string {
  if (granularity === 'year') return value;
  const date = new Date(`${granularity === 'month' ? `${value}-01` : value}T00:00:00.000Z`);
  if (granularity === 'month') return new Intl.DateTimeFormat('vi-VN', { month: '2-digit', year: '2-digit', timeZone: 'UTC' }).format(date);
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`));
}

function isInVietnamDateRange(value: string, from: string, to: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return false;
  const start = Date.parse(`${from}T00:00:00.000+07:00`);
  const end = Date.parse(`${shiftDate(to, 1)}T00:00:00.000+07:00`);
  const timestamp = Date.parse(value);
  return timestamp >= start && timestamp < end;
}

function PlatformBillingLineChart({ data, granularity, from, to, error }: { data: PlatformBillingSummaryDto['revenueSeries'] | null; granularity: PlatformBillingSummaryDto['revenueGranularity']; from: string; to: string; error: string | null }) {
  const values = data?.map((item) => Number(item.amountVnd) || 0) ?? [];
  const maxValue = Math.max(0, ...values);
  const scaleMax = Math.max(1, maxValue);
  const pointCount = data?.length ?? 0;
  const points = (data ?? []).map((item, index) => ({
    item,
    x: pointCount <= 1 ? 328 : 48 + (index / (pointCount - 1)) * 560,
    y: 138 - ((Number(item.amountVnd) || 0) / scaleMax) * 108,
  }));
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const areaPath = points.length > 1 ? `${linePath} L ${points[points.length - 1].x} 138 L ${points[0].x} 138 Z` : '';
  const totalVnd = data?.reduce((sum, item) => sum + Number(item.amountVnd || 0), 0) ?? 0;
  const labelStride = Math.max(1, Math.ceil(points.length / 8));
  const granularityLabel = granularity === 'day' ? 'ngày' : granularity === 'month' ? 'tháng' : 'năm';
  return <section className="platform-overview-chart platform-overview-revenue" aria-labelledby="overview-revenue-title">
    <header><div><h2 id="overview-revenue-title">Doanh thu thanh toán</h2><small>{dateOnlyLabel(from)} – {dateOnlyLabel(to)} · theo {granularityLabel}</small></div><strong>{data ? `${totalVnd.toLocaleString('vi-VN')} đ` : '—'}</strong></header>
    {error ? <p className="platform-overview-chart-message">{error}</p> : <svg className="platform-overview-line-svg" viewBox="0 0 640 176" role="img" aria-label="Biểu đồ đường tổng tiền thanh toán đã xác nhận trong kỳ">
      {[30, 84, 138].map((y, index) => <g key={y}><line x1="48" x2="608" y1={y} y2={y} /><text x="42" y={y + 4} textAnchor="end">{formatCompactVnd(maxValue * (2 - index) / 2)}</text></g>)}
      {areaPath && <path className="platform-overview-line-area" d={areaPath} />}
      {linePath && <path className="platform-overview-line-path" d={linePath} />}
      {points.map(({ item, x, y }, index) => <g key={item.period}><circle cx={x} cy={y} r="4"><title>{item.period}: {Number(item.amountVnd).toLocaleString('vi-VN')} đ · {item.orderCount} đơn</title></circle>{index % labelStride === 0 || index === points.length - 1 ? <text className="platform-overview-line-month" x={x} y="162" textAnchor="middle">{periodLabel(item.period, granularity)}</text> : null}</g>)}
    </svg>}
  </section>;
}

function pieWedgePath(start: number, end: number, radius = 78): string {
  const point = (angle: number) => `${100 + radius * Math.cos(angle)} ${100 + radius * Math.sin(angle)}`;
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M 100 100 L ${point(start)} A ${radius} ${radius} 0 ${largeArc} 1 ${point(end)} Z`;
}

function PlatformTenantPlanPieChart({ data, error }: { data: PlatformBillingSummaryDto['tenantPlanDistribution'] | null; error: string | null }) {
  const plans = (data ?? []).filter((item) => item.tenantCount > 0);
  const total = plans.reduce((sum, item) => sum + item.tenantCount, 0);
  let angle = -Math.PI / 2;
  const slices = plans.map((item, index) => {
    const start = angle;
    angle += total ? (item.tenantCount / total) * Math.PI * 2 : 0;
    return { item, index, start, end: angle };
  });
  return <section className="platform-overview-chart platform-overview-plan-chart" aria-labelledby="overview-plan-title">
    <header><div><h2 id="overview-plan-title">Tỷ lệ tenant theo gói</h2><small>{total} tenant · gói đang gán hiện tại</small></div></header>
    {error ? <p className="platform-overview-chart-message">{error}</p> : total === 0 ? <p className="platform-overview-chart-message">Chưa có dữ liệu gói thuê bao.</p> : <div className="platform-overview-pie-content">
      <svg className="platform-overview-pie-svg" viewBox="0 0 200 200" role="img" aria-label={`Tỷ lệ tenant theo gói, tổng ${total} tenant`}>
        {slices.length === 1 ? <circle className="platform-overview-pie-slice is-plan-0" cx="100" cy="100" r="78" /> : slices.map(({ item, index, start, end }) => <path className={`platform-overview-pie-slice is-plan-${index % 5}`} d={pieWedgePath(start, end)} key={item.planCode}><title>{item.planName}: {item.tenantCount} tenant, {Math.round((item.tenantCount / total) * 100)}%</title></path>)}
      </svg>
      <ul className="platform-overview-pie-legend">{plans.map((item, index) => <li key={item.planCode}><i className={`is-plan-${index % 5}`} aria-hidden="true" /><span>{item.planName}</span><strong>{item.tenantCount}</strong><small>{Math.round((item.tenantCount / total) * 100)}%</small></li>)}</ul>
    </div>}
  </section>;
}

function isConsoleTab(value: string | null): value is ConsoleTab {
  return value === 'overview' || value === 'applications' || value === 'tenants' || value === 'notifications'
    || value === 'billing' || value === 'plans' || value === 'support' || value === 'settings';
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function orderStatusLabel(order: PlatformBillingOrderDto): string {
  if (order.status === 'pending' && Date.parse(order.expiresAt) <= Date.now()) return 'Chờ xử lý · quá hạn';
  return ({ pending: 'Đang chờ', paid: 'Đã thanh toán', paid_review: 'Đã thu · cần xử lý', failed: 'Thất bại', expired: 'Hết hạn', cancelled: 'Đã hủy', refunded: 'Đã hoàn tiền' } as const)[order.status];
}

export default function PlatformPage() {
  const { theme, toggleTheme } = usePlatformTheme();
  const [state, setState] = useState<AccessState>('loading');
  const [tab, setTabState] = useState<ConsoleTab>('overview');
  const [billingView, setBillingViewState] = useState<BillingView>('subscriptions');
  const [todayDate] = useState(() => vietnamDateString());
  const [overviewPeriodMode, setOverviewPeriodMode] = useState<OverviewPeriodMode>('7d');
  const [overviewSelectedDay, setOverviewSelectedDay] = useState(todayDate);
  const [overviewCustomFrom, setOverviewCustomFrom] = useState(() => shiftDate(vietnamDateString(), -6));
  const [overviewCustomTo, setOverviewCustomTo] = useState(todayDate);
  const [overviewFinanceReloadKey, setOverviewFinanceReloadKey] = useState(0);
  const [overviewFinanceLoading, setOverviewFinanceLoading] = useState(false);
  const [latestPaymentOrders, setLatestPaymentOrders] = useState<PlatformBillingOrderDto[]>([]);
  const [reconciliationOrders, setReconciliationOrders] = useState<PlatformBillingOrderDto[]>([]);
  const [reconcilingOrderId, setReconcilingOrderId] = useState<string | null>(null);
  const [reconciliationActionError, setReconciliationActionError] = useState<string | null>(null);
  const [reconciliationActionNotice, setReconciliationActionNotice] = useState<string | null>(null);
  const setTab = useCallback((next: ConsoleTab) => {
    setTabState(next);
    if (next !== 'billing') setBillingViewState('subscriptions');
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    if (next !== 'billing') url.searchParams.delete('billingView');
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.pushState(window.history.state, '', nextUrl);
  }, []);
  const setBillingView = useCallback((next: BillingView) => {
    setBillingViewState(next);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (next === 'orders') url.searchParams.set('billingView', next);
    else url.searchParams.delete('billingView');
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.pushState(window.history.state, '', nextUrl);
  }, []);
  const [tenants, setTenants] = useState<PlatformTenantDto[]>([]);
  const [applications, setApplications] = useState<TenantApplicationDto[]>([]);
  const [notifications, setNotifications] = useState<PlatformNotificationDto[]>([]);
  const [billingSummary, setBillingSummary] = useState<PlatformBillingSummaryDto | null>(null);
  const [billingSummaryError, setBillingSummaryError] = useState<string | null>(null);
  const [notificationConnection, setNotificationConnection] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [notificationFilter, setNotificationFilter] = useState<NotificationFilter>('all');
  const [notificationReadFilter, setNotificationReadFilter] = useState<NotificationReadFilter>('all');
  const [plans, setPlans] = useState<PlatformPlanDto[]>([]);
  const [tenantDetail, setTenantDetail] = useState<PlatformTenantDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [applicationFilter, setApplicationFilter] = useState('pending');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [tenantPlanId, setTenantPlanId] = useState('');
  const [tenantPlanNote, setTenantPlanNote] = useState('');
  const [tenantPlanPassword, setTenantPlanPassword] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const overviewDateRange = useMemo(() => {
    if (overviewPeriodMode === 'day') return { from: overviewSelectedDay, to: overviewSelectedDay };
    if (overviewPeriodMode === '7d') return { from: shiftDate(todayDate, -6), to: todayDate };
    if (overviewPeriodMode === '30d') return { from: shiftDate(todayDate, -29), to: todayDate };
    return { from: overviewCustomFrom, to: overviewCustomTo };
  }, [overviewPeriodMode, overviewSelectedDay, overviewCustomFrom, overviewCustomTo, todayDate]);

  useEffect(() => {
    const syncTabFromUrl = () => {
      const url = new URL(window.location.href);
      const value = url.searchParams.get('tab');
      const billingValue = url.searchParams.get('billingView');
      if (isConsoleTab(value)) {
        setTabState(value);
      } else {
        setTabState('overview');
      }
      const validBillingView = value === 'billing' && billingValue === 'orders';
      setBillingViewState(validBillingView ? 'orders' : 'subscriptions');
      if ((value !== 'billing' && billingValue !== null) || (billingValue !== null && !validBillingView)) {
        url.searchParams.delete('billingView');
      }
      if (!isConsoleTab(value) && value !== null) {
        url.searchParams.delete('tab');
      }
      if (`${url.pathname}${url.search}${url.hash}` !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      }
    };
    syncTabFromUrl();
    window.addEventListener('popstate', syncTabFromUrl);
    return () => window.removeEventListener('popstate', syncTabFromUrl);
  }, []);

  const loadManagementData = useCallback(async (silent = false) => {
    if (!silent) {
      setDataLoading(true);
      setError(null);
    }
    try {
      const [tenantRows, applicationRows, planRows] = await Promise.all([
        api.listPlatformTenants(),
        api.listTenantApplications(),
        api.listPlatformPlans(),
      ]);
      setTenants(tenantRows);
      setApplications(applicationRows);
      setPlans(planRows);
      try { setNotifications(await api.listPlatformNotifications()); }
      catch (err) { if (!silent) setError(err instanceof Error ? err.message : 'Không tải được thông báo.'); }
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'Không tải được dữ liệu vận hành.');
    } finally {
      if (!silent) setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const access = await api.getAuthAccess();
        if (!access.platformAdmin) { if (active) setState('denied'); return; }
        const bootstrap = await api.platformBootstrapStatus();
        if (bootstrap.available) { if (active) setState('bootstrap'); return; }
        if (!bootstrap.tokenConfigured && !bootstrap.adminInitialized) { if (active) setState('bootstrap-unavailable'); return; }
        await api.getPlatformSettings();
        if (!active) return;
        setState('admin');
        await loadManagementData();
      } catch {
        if (active) setState('login');
      }
    })();
    return () => { active = false; };
  }, [loadManagementData]);

  useEffect(() => {
    if (state !== 'admin' || tab !== 'overview') return;
    const intervalId = window.setInterval(() => {
      void loadManagementData(true);
      setOverviewFinanceReloadKey((key) => key + 1);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [state, tab, loadManagementData]);

  useEffect(() => {
    if (state !== 'admin' || tab !== 'overview') return;
    if (!overviewDateRange.from || !overviewDateRange.to || overviewDateRange.from > overviewDateRange.to) {
      setBillingSummaryError('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
      setOverviewFinanceLoading(false);
      setLatestPaymentOrders([]);
      setReconciliationOrders([]);
      return;
    }
    let active = true;
    setOverviewFinanceLoading(true);
    setBillingSummaryError(null);
    const filters = { from: overviewDateRange.from, to: overviewDateRange.to, page: 1, pageSize: 5 };
    void Promise.all([
      api.getPlatformBillingSummary(overviewDateRange.from, overviewDateRange.to),
      api.listPlatformBillingOrders(filters),
      api.listPlatformBillingReconciliationOrders({ page: 1, pageSize: 5 }),
    ]).then(([summary, orders, reconciliation]) => {
      if (!active) return;
      setBillingSummary(summary);
      setLatestPaymentOrders(orders.items);
      setReconciliationOrders(reconciliation);
      setReconciliationActionError(null);
    }).catch((cause: unknown) => {
      if (!active) return;
      setBillingSummary(null);
      setLatestPaymentOrders([]);
      setReconciliationOrders([]);
      setBillingSummaryError(cause instanceof Error ? cause.message : 'Không tải được tổng quan Billing.');
    }).finally(() => { if (active) setOverviewFinanceLoading(false); });
    return () => { active = false; };
  }, [state, tab, overviewDateRange, overviewFinanceReloadKey]);

  useEffect(() => {
    if (state !== 'admin') return;
    let active = true;
    let requestInFlight = false;
    let refreshQueued = false;
    const refreshNotifications = async () => {
      if (requestInFlight) { refreshQueued = true; return; }
      requestInFlight = true;
      do {
        refreshQueued = false;
        try {
          const rows = await api.listPlatformNotifications();
          if (active) setNotifications(rows);
        } catch { /* Keep the last successful snapshot; the stream will retry and sync on reconnect. */ }
      } while (active && refreshQueued);
      requestInFlight = false;
    };
    const disconnect = api.connectPlatformNotificationStream(
      () => void refreshNotifications(),
      (status) => { if (active) setNotificationConnection(status); },
    );
    return () => {
      active = false;
      disconnect();
    };
  }, [state]);

  const pendingCount = useMemo(() => applications.filter((application) => application.status === 'pending').length, [applications]);
  const pendingApplications = useMemo(() => applications.filter((application) => application.status === 'pending')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [applications]);
  const activeTenantsInRange = useMemo(() => tenants.filter((tenant) => tenant.status === 'active'
    && isInVietnamDateRange(tenant.createdAt, overviewDateRange.from, overviewDateRange.to))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [tenants, overviewDateRange]);
  const unreadNotificationCount = useMemo(() => notifications.filter((notification) => !notification.isRead).length, [notifications]);
  const filteredNotifications = useMemo(() => notifications.filter((notification) => {
    const matchesType = notificationFilter === 'all' || notification.type === notificationFilter;
    const matchesRead = notificationReadFilter === 'all' || (notificationReadFilter === 'unread' ? !notification.isRead : notification.isRead);
    return matchesType && matchesRead;
  }), [notifications, notificationFilter, notificationReadFilter]);

  const filteredApplications = useMemo(() => applications.filter((application) => {
    const matchesStatus = applicationFilter === 'all' || application.status === applicationFilter;
    const search = `${application.name} ${application.slug} ${application.applicantName} ${application.applicantEmail}`.toLowerCase();
    return matchesStatus && search.includes(query.trim().toLowerCase());
  }), [applications, applicationFilter, query]);
  const filteredTenants = useMemo(() => tenants.filter((tenant) => {
    const matchesStatus = tenantFilter === 'all' || tenant.status === tenantFilter;
    const search = `${tenant.displayName} ${tenant.slug} ${tenant.ownerName ?? ''} ${tenant.ownerEmail ?? ''}`.toLowerCase();
    return matchesStatus && search.includes(query.trim().toLowerCase());
  }), [tenants, tenantFilter, query]);
  const selectedApplication = applications.find((application) => application.id === selectedApplicationId) ?? null;

  const reconcileDashboardPayment = async (orderId: string) => {
    if (reconcilingOrderId) return;
    setReconcilingOrderId(orderId);
    setReconciliationActionError(null);
    setReconciliationActionNotice(null);
    try {
      const result = await api.reconcilePlatformBillingOrder(orderId);
      setReconciliationActionNotice(result.message);
      setOverviewFinanceReloadKey((key) => key + 1);
    } catch (cause) {
      setReconciliationActionError(cause instanceof Error ? cause.message : 'Không đối soát được giao dịch.');
    } finally {
      setReconcilingOrderId(null);
    }
  };

  const reviewApplication = async (application: TenantApplicationDto, decision: 'approve' | 'reject') => {
    if (actionId) return;
    const confirmText = decision === 'approve'
      ? `Duyệt hồ sơ “${application.name}” và tạo tenant hoạt động?`
      : `Từ chối hồ sơ “${application.name}”? Người đăng ký có thể gửi hồ sơ mới.`;
    if (!window.confirm(confirmText)) return;
    setActionId(application.id); setError(null); setNotice(null);
    try {
      const reviewed = await api.reviewTenantApplication(application.id, { decision, note: reviewNotes[application.id] || undefined });
      setApplications((rows) => rows.map((row) => row.id === reviewed.id ? reviewed : row));
      void api.listPlatformNotifications().then(setNotifications).catch(() => undefined);
      if (decision === 'approve') {
        setNotice(`Đã duyệt ${reviewed.name}. Tenant và quyền owner đã được tạo.`);
        setTenants(await api.listPlatformTenants());
      } else setNotice(`Đã từ chối hồ sơ ${reviewed.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xử lý được hồ sơ.');
    } finally { setActionId(null); }
  };

  const markNotificationRead = async (notification: PlatformNotificationDto) => {
    if (notification.isRead) return;
    try {
      await api.markPlatformNotificationRead(notification.id);
      setNotifications((rows) => rows.map((row) => row.id === notification.id ? { ...row, isRead: true } : row));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không cập nhật được trạng thái thông báo.');
    }
  };

  const changeTenantStatus = async (tenant: PlatformTenantDto) => {
    if (actionId) return;
    const nextStatus = tenant.status === 'active' ? 'suspended' : 'active';
    if (!window.confirm(`${nextStatus === 'suspended' ? 'Tạm ngưng' : 'Kích hoạt lại'} tenant “${tenant.displayName}”?`)) return;
    setActionId(tenant.id); setError(null); setNotice(null);
    try {
      const updated = await api.updatePlatformTenantStatus(tenant.id, { status: nextStatus });
      setTenants((rows) => rows.map((row) => row.id === updated.id ? updated : row));
      setNotice(`${updated.displayName} hiện ${updated.status === 'active' ? 'đang hoạt động' : 'đã tạm ngưng'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không cập nhật được trạng thái tenant.');
    } finally { setActionId(null); }
  };

  const openTenantDetail = async (tenantId: string) => {
    setDetailLoading(true);
    setTenantDetail(null);
    try { const detail = await api.getPlatformTenantDetail(tenantId); setTenantDetail(detail); setTenantPlanId(''); setTenantPlanNote(''); setTenantPlanPassword(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Khong tai duoc chi tiet tenant.'); }
    finally { setDetailLoading(false); }
  };

  const assignPlan = async () => {
    if (!tenantDetail || !tenantPlanId || tenantPlanNote.trim().length < 3 || !tenantPlanPassword || actionId) return;
    if (!window.confirm('Gán gói này cho tenant và bắt đầu kỳ mới từ hôm nay? Thao tác sẽ được lưu vào lịch sử quản trị.')) return;
    setActionId(tenantDetail.id); setError(''); setNotice('');
    try {
      await api.assignPlatformTenantPlan(tenantDetail.id, { planId: tenantPlanId, note: tenantPlanNote.trim(), currentPassword: tenantPlanPassword });
      setTenantDetail(await api.getPlatformTenantDetail(tenantDetail.id)); setNotice('Đã gán gói hỗ trợ và ghi lịch sử quản trị; thao tác này không được tính là doanh thu.'); setTenantPlanNote(''); setTenantPlanPassword('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Không cập nhật được gói tenant.'); }
    finally { setActionId(null); }
  };

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true); setError('');
    try { await api.logout(); window.location.assign('/login'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Không đăng xuất được. Hãy thử lại.'); setLoggingOut(false); }
  };

  return (
    <main className="app-page platform-page" data-theme={theme}>
      <div className="app-container platform-container">
        <aside className="platform-sidebar" aria-label="Platform Admin">
          <Link className="platform-brand" href="/" aria-label="ZenBook Platform Admin, về trang chủ"><span className="platform-brand-mark">Z</span><span>ZenBook<small>PLATFORM ADMIN</small></span></Link>
          <span className="platform-sidebar-label">QUẢN TRỊ HỆ THỐNG</span>
          <nav className="platform-sidebar-nav" aria-label="Điều hướng hệ thống">
            <button type="button" className={`platform-side-link ${tab === 'overview' ? 'is-active' : ''}`} aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7"/></svg><span>Tổng quan</span></button>
            <button type="button" className={`platform-side-link ${tab === 'applications' ? 'is-active' : ''}`} aria-pressed={tab === 'applications'} onClick={() => { setTab('applications'); setQuery(''); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h8l4 4v14H7zM15 3v5h4M10 12h6M10 16h6"/></svg><span>Hồ sơ đăng ký</span><i>{pendingCount}</i></button>
            <button type="button" className={`platform-side-link ${tab === 'tenants' ? 'is-active' : ''}`} aria-pressed={tab === 'tenants'} onClick={() => { setTab('tenants'); setQuery(''); }}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/></svg><span>Danh sách tenant</span></button>
            <button type="button" className={`platform-side-link ${tab === 'support' ? 'is-active' : ''}`} aria-pressed={tab === 'support'} onClick={() => setTab('support')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-6.5a2.5 2.5 0 0 1-1-2z"/><path d="M8 8h8M8 12h5"/></svg><span>Hỗ trợ</span></button>
            <button type="button" className={`platform-side-link ${tab === 'billing' ? 'is-active' : ''}`} aria-pressed={tab === 'billing'} onClick={() => setTab('billing')}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg><span>Billing</span></button>
            <button type="button" className={`platform-side-link ${tab === 'plans' ? 'is-active' : ''}`} aria-pressed={tab === 'plans'} onClick={() => setTab('plans')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18" cy="18" r="3"/></svg><span>Gói dịch vụ</span></button>
            <button type="button" className={`platform-side-link ${tab === 'notifications' ? 'is-active' : ''}`} aria-pressed={tab === 'notifications'} onClick={() => setTab('notifications')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span>Thông báo</span>{unreadNotificationCount > 0 && <i>{unreadNotificationCount}</i>}</button>
            <button type="button" className={`platform-side-link ${tab === 'settings' ? 'is-active' : ''}`} aria-pressed={tab === 'settings'} onClick={() => { setTab('settings'); setQuery(''); }}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.9Z"/></svg><span>Cấu hình</span></button>
          </nav>
          <div className="platform-sidebar-footer">
            <button className="platform-theme-toggle" type="button" onClick={toggleTheme} aria-label={`Chuyển sang chế độ ${theme === 'light' ? 'Warm Dark' : 'Soft Light'}`} aria-pressed={theme === 'dark'}><span aria-hidden="true">{theme === 'light' ? '☾' : '☼'}</span>{theme === 'light' ? 'Soft Light' : 'Warm Dark'}</button>
            <button type="button" className="platform-sidebar-logout" onClick={() => void logout()} disabled={loggingOut}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10"/></svg><span>{loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}</span></button>
          </div>
        </aside>

        <div className={`platform-dashboard-main is-${tab}`}>
        {state === 'loading' && <section className="platform-access-card"><div className="platform-loading-mark">S</div><p className="eyebrow">PLATFORM OPERATIONS</p><h1>Đang xác thực quyền truy cập</h1><p>Chỉ quản trị viên hệ thống mới xem được dữ liệu tenant và hồ sơ đăng ký.</p><div className="platform-loading-line" /></section>}
        {state === 'login' && <section className="platform-access-card"><div className="platform-loading-mark">S</div><p className="eyebrow">PLATFORM OPERATIONS</p><h1>Đăng nhập để tiếp tục</h1><p>Đăng nhập bằng tài khoản được cấp quyền quản trị hệ thống. Owner/admin của tenant không có quyền này.</p><Link className="button button-primary" href="/login">Đăng nhập</Link></section>}
        {state === 'bootstrap' && <section className="platform-access-card"><div className="platform-loading-mark">S</div><p className="eyebrow">PLATFORM OPERATIONS</p><h1>Khởi tạo quản trị viên hệ thống</h1><p>Quy trình bootstrap một lần đang khả dụng. Tiếp tục bằng tài khoản và token đã cấu hình ở máy chủ.</p><Link className="button button-primary" href="/platform/settings">Tiếp tục khởi tạo</Link></section>}
        {state === 'bootstrap-unavailable' && <section className="platform-access-card"><p className="eyebrow">PLATFORM OPERATIONS</p><h1>Chưa thể khởi tạo quản trị hệ thống</h1><p>Máy chủ chưa bật quy trình bootstrap. Hãy cấu hình ở phía máy chủ trước khi tiếp tục.</p></section>}
        {state === 'denied' && <section className="platform-access-card is-denied"><p className="eyebrow">TRUY CẬP BỊ TỪ CHỐI</p><h1>Tài khoản chưa có quyền quản trị hệ thống</h1><p>Quyền owner hoặc admin của tenant không cấp quyền quản trị nền tảng.</p><div className="action-row"><Link className="button button-secondary" href="/login">Đăng nhập tài khoản khác</Link><Link className="button button-quiet" href="/">Về trang chủ</Link></div></section>}

        {state === 'admin' && <>
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          {notice && <div className="notice notice-success" role="status">{notice}</div>}

          <section className={`platform-console-card${tab === 'overview' ? ' is-overview' : ''}${tab === 'settings' ? ' is-settings' : ''}${tab === 'billing' ? ' is-billing' : ''}`} aria-label={tab === 'overview' ? 'Tổng quan nền tảng' : tab === 'settings' ? 'Cấu hình hệ thống' : tab === 'billing' ? 'Billing tenant' : 'Quản lý tenant và hồ sơ đăng ký'}>
            {(tab === 'applications' || tab === 'tenants') && <div className="platform-list-toolbar">
              <label className="platform-search"><span className="sr-only">Tìm kiếm</span><span className="platform-search-control"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6"/><path d="m16 16 4.5 4.5"/></svg><input aria-label="Tìm kiếm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'applications' ? 'Tên tiệm, slug, email…' : 'Tên tenant, slug, owner…'} /></span></label>
              {tab === 'applications' ? <label className="platform-filter"><span className="sr-only">Bộ lọc</span><select aria-label="Lọc hồ sơ theo trạng thái" value={applicationFilter} onChange={(event) => setApplicationFilter(event.target.value)}><option value="pending">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Đã từ chối</option><option value="all">Tất cả</option></select></label> : <label className="platform-filter"><span className="sr-only">Bộ lọc</span><select aria-label="Lọc tenant theo trạng thái" value={tenantFilter} onChange={(event) => setTenantFilter(event.target.value)}><option value="all">Tất cả</option><option value="active">Đang hoạt động</option><option value="suspended">Đang tạm ngưng</option></select></label>}
              <button type="button" className="platform-refresh-button is-icon-only" aria-label="Làm mới dữ liệu" title="Làm mới" disabled={dataLoading} onClick={() => void loadManagementData()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7 7 0 0 1 11.8-2L20 12M4 12l2.7 5a7 7 0 0 0 11.8-2"/></svg></button>
            </div>}

            {tab === 'support' && <PlatformSupportPanel />}
            {tab === 'settings' && <PlatformSettingsPanel embedded />}
            {tab === 'billing' && <PlatformBillingPanel key={billingView} plans={plans} view={billingView} onViewChange={setBillingView} onOpenTenant={(tenantId) => void openTenantDetail(tenantId)} />}
            {tab === 'plans' && <PlatformPlansPanel plans={plans} onChanged={() => void loadManagementData(true)} />}
            {!dataLoading && tab === 'notifications' && <>
              <div className="platform-notification-filters">
                <div className="platform-notification-type-filters" role="group" aria-label="Lọc loại thông báo">
                {([
                  { key: 'all', label: 'Tất cả', count: notifications.length },
                  { key: 'tenant_application_submitted', label: 'Hồ sơ mới', count: notifications.filter((notification) => notification.type === 'tenant_application_submitted').length },
                  { key: 'tenant_application_reviewed', label: 'Kết quả duyệt', count: notifications.filter((notification) => notification.type === 'tenant_application_reviewed').length },
                ] as const).map((filter) => <button type="button" key={filter.key} className={`platform-notification-filter${notificationFilter === filter.key ? ' is-active' : ''}`} aria-pressed={notificationFilter === filter.key} onClick={() => setNotificationFilter(filter.key)}>{filter.label}<span>{filter.count}</span></button>)}
                </div>
                <div className="platform-notification-read-filters" role="group" aria-label="Lọc trạng thái đã đọc">
                {([
                  { key: 'all', label: 'Tất cả trạng thái' },
                  { key: 'unread', label: 'Chưa đọc', count: unreadNotificationCount },
                  { key: 'read', label: 'Đã đọc' },
                ] as const).map((filter) => <button type="button" key={filter.key} className={`platform-notification-filter${notificationReadFilter === filter.key ? ' is-active' : ''}`} aria-pressed={notificationReadFilter === filter.key} onClick={() => setNotificationReadFilter(filter.key)}>{filter.label}{'count' in filter && <span>{filter.count}</span>}</button>)}
                </div>
                <span className={`platform-notification-live is-${notificationConnection}`}><i aria-hidden="true" />{notificationConnection === 'connected' ? 'Đang nhận trực tiếp' : notificationConnection === 'reconnecting' ? 'Đang kết nối lại' : 'Đang kết nối'}</span>
              </div>
              <div className="platform-notification-list" aria-live="polite">
              {filteredNotifications.map((notification) => <article className={`platform-notification-row${notification.isRead ? ' is-read' : ' is-unread'}`} key={notification.id}>
                <span className={`platform-notification-mark is-${notification.type}`} aria-hidden="true" />
                <div><div className="platform-notification-title"><strong>{notification.title}</strong><span className={`platform-notification-read-state ${notification.isRead ? 'is-read' : 'is-unread'}`}>{notification.isRead ? 'Đã đọc' : 'Chưa đọc'}</span></div><p>{notification.description}</p><time dateTime={notification.occurredAt}>{dateLabel(notification.occurredAt)}</time></div>
                <div className="platform-notification-actions">
                  {notification.applicationId && <button type="button" className="platform-overview-link" onClick={() => { void markNotificationRead(notification); const application = applications.find((item) => item.id === notification.applicationId); setTab('applications'); setApplicationFilter('all'); setQuery(application?.name ?? ''); setSelectedApplicationId(application?.id ?? null); }}>Mở hồ sơ <span aria-hidden="true">›</span></button>}
                  {!notification.isRead && <button type="button" className="platform-notification-mark-read" onClick={() => void markNotificationRead(notification)}>Đánh dấu đã đọc</button>}
                </div>
              </article>)}
              {notifications.length === 0 && <div className="platform-empty-state"><strong>Chưa có thông báo</strong><p>Hồ sơ mới và kết quả duyệt sẽ xuất hiện tại đây.</p></div>}
              {notifications.length > 0 && filteredNotifications.length === 0 && <div className="platform-empty-state"><strong>Không có thông báo phù hợp</strong><p>Thử chọn loại khác hoặc đổi bộ lọc trạng thái đọc.</p></div>}
              </div>
            </>}
            {tab !== 'settings' && dataLoading && <div className="platform-empty-state" role="status">Đang tải dữ liệu quản trị…</div>}
            {!dataLoading && tab === 'overview' && <div className="platform-overview-dashboard">
              <div className="platform-overview-period-toolbar">
                <div className="platform-overview-period-heading"><strong>Kỳ dữ liệu</strong><span>{overviewDateRange.from && overviewDateRange.to ? `${dateOnlyLabel(overviewDateRange.from)} – ${dateOnlyLabel(overviewDateRange.to)}` : 'Chọn khoảng thời gian'}</span></div>
                <div className="platform-overview-period-controls">
                  <label><span>Khoảng xem</span><select aria-label="Chọn khoảng thời gian tổng quan" value={overviewPeriodMode} onChange={(event) => setOverviewPeriodMode(event.target.value as OverviewPeriodMode)}><option value="day">Ngày cụ thể</option><option value="7d">7 ngày gần nhất</option><option value="30d">30 ngày gần nhất</option><option value="custom">Tùy chọn khoảng</option></select></label>
                  {overviewPeriodMode === 'day' && <label><span>Ngày</span><input aria-label="Chọn ngày tổng quan" type="date" max={todayDate} value={overviewSelectedDay} onChange={(event) => setOverviewSelectedDay(event.target.value)} /></label>}
                  {overviewPeriodMode === 'custom' && <>
                    <label><span>Từ ngày</span><input aria-label="Ngày bắt đầu tổng quan" type="date" max={overviewCustomTo || todayDate} value={overviewCustomFrom} onChange={(event) => setOverviewCustomFrom(event.target.value)} /></label>
                    <label><span>Đến ngày</span><input aria-label="Ngày kết thúc tổng quan" type="date" min={overviewCustomFrom} max={todayDate} value={overviewCustomTo} onChange={(event) => setOverviewCustomTo(event.target.value)} /></label>
                  </>}
                  <button type="button" className="platform-refresh-button is-icon-only" aria-label="Làm mới tổng quan" title="Làm mới" disabled={overviewFinanceLoading} onClick={() => setOverviewFinanceReloadKey((key) => key + 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7 7 0 0 1 11.8-2L20 12M4 12l2.7 5a7 7 0 0 0 11.8-2"/></svg></button>
                </div>
              </div>
              <div className="platform-overview-charts">
                <PlatformBillingLineChart data={billingSummary?.revenueSeries ?? null} granularity={billingSummary?.revenueGranularity ?? 'day'} from={overviewDateRange.from} to={overviewDateRange.to} error={billingSummaryError} />
                <PlatformTenantPlanPieChart data={billingSummary?.tenantPlanDistribution ?? null} error={billingSummaryError} />
              </div>
              {overviewFinanceLoading && <p className="platform-overview-loading" role="status">Đang cập nhật dữ liệu trong kỳ…</p>}
              <div className="platform-overview-lists">
                <section className="platform-overview-panel" aria-labelledby="overview-pending-title">
                  <header><div><h2 id="overview-pending-title">Hồ sơ chờ duyệt</h2><small>{pendingApplications.length} hồ sơ · mới nhất</small></div><button type="button" className="platform-overview-link" onClick={() => { setApplicationFilter('pending'); setQuery(''); setTab('applications'); }}>Xem danh sách <span aria-hidden="true">›</span></button></header>
                  <div className="platform-overview-panel-list">
                    {pendingApplications.slice(0, 4).map((application) => <article className="platform-overview-row" key={application.id}>
                      <div className="platform-overview-row-main"><strong>{application.name}</strong><span>{application.applicantName}</span><small>{application.applicantEmail} · {dateLabel(application.createdAt)}</small></div>
                      <span className="platform-status is-pending">Chờ duyệt</span>
                    </article>)}
                    {pendingApplications.length === 0 && <div className="platform-overview-empty">Không có hồ sơ đang chờ duyệt.</div>}
                  </div>
                </section>
                <section className="platform-overview-panel" aria-labelledby="overview-active-tenants-title">
                  <header><div><h2 id="overview-active-tenants-title">Tenant hoạt động mới</h2><small>{activeTenantsInRange.length} tenant trong kỳ · mới nhất</small></div><button type="button" className="platform-overview-link" onClick={() => { setTenantFilter('active'); setQuery(''); setTab('tenants'); }}>Xem danh sách <span aria-hidden="true">›</span></button></header>
                  <div className="platform-overview-panel-list">
                    {activeTenantsInRange.slice(0, 4).map((tenant) => <article className="platform-overview-row" key={tenant.id}>
                      <div className="platform-overview-row-main"><strong>{tenant.displayName}</strong><span>/{tenant.slug}</span><small>{tenant.ownerName || 'Chưa có owner'} · {tenant.ownerEmail || 'Chưa có email'}</small></div>
                      <div className="platform-overview-row-meta"><span className="platform-status is-active">Hoạt động</span><time dateTime={tenant.createdAt}>{dateLabel(tenant.createdAt)}</time></div>
                    </article>)}
                    {activeTenantsInRange.length === 0 && <div className="platform-overview-empty">Không có tenant mới hoạt động trong kỳ này.</div>}
                  </div>
                </section>
                <section className="platform-overview-panel" aria-labelledby="overview-latest-orders-title">
                  <header><div><h2 id="overview-latest-orders-title">Đơn thanh toán mới nhất</h2><small>{Math.min(latestPaymentOrders.length, 4)} đơn gần nhất trong kỳ</small></div><button type="button" className="platform-overview-link" onClick={() => { setTab('billing'); setBillingView('orders'); }}>Mở Billing <span aria-hidden="true">›</span></button></header>
                  <div className="platform-overview-panel-list">
                    {latestPaymentOrders.slice(0, 4).map((order) => <article className="platform-overview-row" key={order.id}>
                      <div className="platform-overview-row-main"><strong>{order.tenantName}</strong><span>{order.planName} · {order.provider.toUpperCase()}</span><small>{dateLabel(order.createdAt)} · {order.id.slice(0, 8)}</small></div>
                      <div className="platform-overview-row-meta"><strong>{order.amountVnd.toLocaleString('vi-VN')} đ</strong><span className={`platform-status is-${order.status}`}>{orderStatusLabel(order)}</span></div>
                    </article>)}
                    {!overviewFinanceLoading && !billingSummaryError && latestPaymentOrders.length === 0 && <div className="platform-overview-empty">Không có đơn thanh toán trong kỳ này.</div>}
                  </div>
                </section>
                <section className="platform-overview-panel" aria-labelledby="overview-reconciliation-title">
                  <header><div><h2 id="overview-reconciliation-title">Thanh toán cần đối soát</h2><small>{Math.min(reconciliationOrders.length, 4)} đơn VNPAY mới nhất · mọi thời điểm</small></div><button type="button" className="platform-overview-link" onClick={() => { setTab('billing'); setBillingView('orders'); }}>Mở Billing <span aria-hidden="true">›</span></button></header>
                  {reconciliationActionError && <p className="platform-overview-action-message is-error" role="alert">{reconciliationActionError}</p>}
                  {reconciliationActionNotice && <p className="platform-overview-action-message" role="status">{reconciliationActionNotice}</p>}
                  <div className="platform-overview-panel-list">
                    {reconciliationOrders.slice(0, 4).map((order) => <article className="platform-overview-row" key={order.id}>
                      <div className="platform-overview-row-main"><strong>{order.tenantName}</strong><span>{order.amountVnd.toLocaleString('vi-VN')} đ · VNPAY</span><small>{dateLabel(order.createdAt)} · {orderStatusLabel(order)}</small></div>
                      <button type="button" className="button button-secondary platform-overview-reconcile" disabled={Boolean(reconcilingOrderId)} onClick={() => void reconcileDashboardPayment(order.id)}>{reconcilingOrderId === order.id ? 'Đang đối soát…' : 'Đối soát'}</button>
                    </article>)}
                    {!overviewFinanceLoading && !billingSummaryError && reconciliationOrders.length === 0 && <div className="platform-overview-empty">Không có đơn VNPAY cần đối soát.</div>}
                  </div>
                </section>
              </div>
            </div>}
            {!dataLoading && tab === 'applications' && <div className="platform-record-list">
              {filteredApplications.map((application) => <article className="platform-application-record" key={application.id}>
                <div className="platform-application-card-main"><div className="platform-record-icon" aria-hidden="true">{application.name.slice(0, 1).toUpperCase()}</div><div className="platform-application-card-copy"><div className="platform-record-title"><h2>{application.name}</h2><span className={`platform-status is-${application.status}`}>{application.status === 'pending' ? 'Chờ duyệt' : application.status === 'approved' ? 'Đã duyệt' : 'Đã từ chối'}</span></div><p>{application.applicantName} <span>·</span> {application.applicantEmail}</p><div className="platform-application-card-meta"><span>{application.serviceType}</span><span>Gói {plans.find((plan) => plan.code === application.requestedPlan)?.displayName ?? application.requestedPlan}</span><time dateTime={application.createdAt}>{dateLabel(application.createdAt)}</time></div></div></div>
                <button className="button button-secondary platform-application-open" type="button" onClick={() => setSelectedApplicationId(application.id)}>Chi tiết hồ sơ <span aria-hidden="true">›</span></button>
              </article>)}
              {filteredApplications.length === 0 && <div className="platform-empty-state"><strong>{applications.length ? 'Không có hồ sơ phù hợp' : 'Chưa có đăng ký tenant'}</strong><p>{applications.length ? 'Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.' : 'Hồ sơ mới sẽ xuất hiện ở đây sau khi chủ tiệm gửi đăng ký.'}</p></div>}
            </div>}

            {!dataLoading && tab === 'tenants' && <div className="platform-tenant-table-wrap"><table className="platform-tenant-table"><thead><tr><th>Tenant</th><th>Owner</th><th>Ngày tạo</th><th>Trạng thái</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>
              {filteredTenants.map((tenant) => <tr key={tenant.id}><td><button type="button" className="platform-tenant-detail-link" onClick={() => void openTenantDetail(tenant.id)}>{tenant.displayName}</button><small>/{tenant.slug}</small></td><td>{tenant.ownerName || 'Chưa có owner'}<small>{tenant.ownerEmail || '-'}</small></td><td>{dateLabel(tenant.createdAt)}</td><td><span className={`platform-status is-${tenant.status}`}>{tenant.status === 'active' ? 'Hoạt động' : 'Tạm ngưng'}</span></td><td><button type="button" className={`button ${tenant.status === 'active' ? 'button-danger-soft' : 'button-primary'}`} disabled={actionId !== null} onClick={() => void changeTenantStatus(tenant)}>{tenant.status === 'active' ? 'Tạm ngưng' : 'Kích hoạt'}</button></td></tr>)}
              {filteredTenants.length === 0 && <tr><td colSpan={5}><div className="platform-empty-state"><strong>{tenants.length ? 'Không tìm thấy tenant' : 'Chưa có tenant'}</strong><p>{tenants.length ? 'Thử thay đổi bộ lọc hoặc từ khóa.' : 'Tenant sẽ được tạo sau khi hồ sơ đăng ký được duyệt.'}</p></div></td></tr>}
            </tbody></table></div>}
          </section>
        </>}
        </div>
      </div>
      {selectedApplication && <div className="platform-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedApplicationId(null); }}>
        <section className="platform-application-detail" role="dialog" aria-modal="true" aria-labelledby="application-detail-title">
          <header><div><small>HỒ SƠ ĐĂNG KÝ</small><h2 id="application-detail-title">{selectedApplication.name}</h2></div><button type="button" aria-label="Đóng chi tiết hồ sơ" onClick={() => setSelectedApplicationId(null)}>×</button></header>
          <div className="platform-detail-summary"><span className={`platform-status is-${selectedApplication.status}`}>{selectedApplication.status === 'pending' ? 'Chờ duyệt' : selectedApplication.status === 'approved' ? 'Đã duyệt' : 'Đã từ chối'}</span><span>/{selectedApplication.slug}</span></div>
          <dl className="platform-application-detail-grid">
            <div><dt>Chủ tiệm</dt><dd>{selectedApplication.applicantName}</dd></div><div><dt>Email</dt><dd>{selectedApplication.applicantEmail}</dd></div>
            <div><dt>Số điện thoại</dt><dd>{selectedApplication.contactPhone}</dd></div><div><dt>Loại hình dịch vụ</dt><dd>{selectedApplication.serviceType}</dd></div>
            <div><dt>Gói đăng ký</dt><dd>{plans.find((plan) => plan.code === selectedApplication.requestedPlan)?.displayName ?? selectedApplication.requestedPlan}</dd></div><div><dt>Múi giờ / tiền tệ</dt><dd>{selectedApplication.timezone} · {selectedApplication.currency}</dd></div>
            <div><dt>Ngày gửi</dt><dd>{dateLabel(selectedApplication.createdAt)}</dd></div><div><dt>Ngày xét duyệt</dt><dd>{selectedApplication.reviewedAt ? dateLabel(selectedApplication.reviewedAt) : 'Chưa xét duyệt'}</dd></div>
            <div><dt>Trạng thái tài khoản</dt><dd>{selectedApplication.applicantUserId ? 'Đã liên kết tài khoản' : 'Chưa liên kết tài khoản'}</dd></div><div><dt>Mã hồ sơ</dt><dd>{selectedApplication.id}</dd></div>
          </dl>
          {selectedApplication.reviewNote && <p className="platform-application-review-note"><strong>Ghi chú xét duyệt</strong>{selectedApplication.reviewNote}</p>}
          {selectedApplication.status === 'pending' && <div className="platform-application-review"><label className="platform-review-input">Ghi chú cho người đăng ký<textarea value={reviewNotes[selectedApplication.id] ?? ''} maxLength={1000} onChange={(event) => setReviewNotes((notes) => ({ ...notes, [selectedApplication.id]: event.target.value }))} placeholder="Lý do từ chối hoặc lưu ý khi duyệt (không bắt buộc)" /></label><div className="platform-review-buttons"><button className="button button-primary" type="button" disabled={actionId !== null} onClick={() => void reviewApplication(selectedApplication, 'approve')}>{actionId === selectedApplication.id ? 'Đang xử lý…' : 'Duyệt hồ sơ'}</button><button className="button button-danger-soft" type="button" disabled={actionId !== null} onClick={() => void reviewApplication(selectedApplication, 'reject')}>Từ chối</button></div></div>}
        </section>
      </div>}
      {(tenantDetail || detailLoading) && <div className="platform-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTenantDetail(null); }}>
        <section className="platform-tenant-detail" role="dialog" aria-modal="true" aria-labelledby="tenant-detail-title">
          <header><div><small>CHI TIẾT TENANT</small><h2 id="tenant-detail-title">{tenantDetail?.displayName ?? 'Đang tải…'}</h2></div><button type="button" aria-label="Đóng chi tiết" onClick={() => { setTenantDetail(null); setTenantPlanPassword(''); }}>×</button></header>
          {tenantDetail && <><div className="platform-detail-summary"><span className={`platform-status is-${tenantDetail.status}`}>{tenantDetail.status === 'active' ? 'Hoạt động' : 'Tạm ngưng'}</span><span>/{tenantDetail.slug}</span></div>
            <dl className="platform-detail-grid">
              <div><dt>Chủ tiệm</dt><dd>{tenantDetail.ownerName || 'Chưa có'}</dd></div><div><dt>Email</dt><dd>{tenantDetail.ownerEmail || 'Chưa có'}</dd></div>
              <div><dt>Địa điểm</dt><dd>{tenantDetail.locationName || 'Chưa cấu hình'}</dd></div><div><dt>Múi giờ / tiền tệ</dt><dd>{tenantDetail.timezone || '—'} · {tenantDetail.currency || '—'}</dd></div>
              <div><dt>Ngày tạo</dt><dd>{dateLabel(tenantDetail.createdAt)}</dd></div><div><dt>Cập nhật gần nhất</dt><dd>{dateLabel(tenantDetail.updatedAt)}</dd></div>
            </dl>
            <div className="platform-detail-metrics"><div><strong>{tenantDetail.staffProfileCount}</strong><span>Hồ sơ nhân viên</span></div><div><strong>{tenantDetail.serviceCount}</strong><span>Dịch vụ</span></div><div><strong>{tenantDetail.bookingCount}</strong><span>Lịch đặt</span></div></div>
            <section className="platform-tenant-billing"><header><div><h3>Gói dịch vụ</h3><p>{tenantDetail.billing ? `${tenantDetail.billing.usage.activeStaff}/${tenantDetail.billing.plan.activeStaffLimit} nhân viên · ${tenantDetail.billing.usage.bookings}/${tenantDetail.billing.usage.bookingLimit ?? '∞'} lịch trong kỳ` : 'Tenant chưa có gói được gán.'}</p></div></header>
              {tenantDetail.billing && <p className="platform-plan-current">{tenantDetail.billing.plan.displayName} · {tenantDetail.billing.plan.priceVnd.toLocaleString('vi-VN')} đ/tháng · đến {dateLabel(tenantDetail.billing.periodEnd)}</p>}
              <div className="platform-plan-assign"><label>Gán gói hỗ trợ<select value={tenantPlanId} onChange={(event) => setTenantPlanId(event.target.value)}><option value="">Chọn gói đang hoạt động</option>{plans.filter((plan) => plan.isActive).map((plan) => <option key={plan.id} value={plan.id}>{plan.displayName} · {plan.priceVnd.toLocaleString('vi-VN')} đ</option>)}</select></label><label>Ghi chú bắt buộc<input value={tenantPlanNote} maxLength={1000} onChange={(event) => setTenantPlanNote(event.target.value)} placeholder="Lý do hỗ trợ" /></label><label>Mật khẩu quản trị<input type="password" autoComplete="current-password" value={tenantPlanPassword} onChange={(event) => setTenantPlanPassword(event.target.value)} /></label><button type="button" className="button button-primary" disabled={actionId !== null || !tenantPlanId || tenantPlanNote.trim().length < 3 || !tenantPlanPassword} onClick={() => void assignPlan()}>{actionId === tenantDetail.id ? 'Đang lưu…' : 'Gán gói hỗ trợ'}</button></div>
              {tenantDetail.planChanges.length > 0 && <ul className="platform-plan-history">{tenantDetail.planChanges.map((change, index) => <li key={`${change.changedAt}-${index}`}><span>{change.fromPlan ?? 'Chưa gán'} → {change.toPlan}</span><small>{change.note} · {dateLabel(change.changedAt)}</small></li>)}</ul>}
            </section>
            <div className="platform-detail-lists">
              <section><h3>Nhân viên</h3>{tenantDetail.staffProfiles.length ? <ul>{tenantDetail.staffProfiles.map((person, index) => <li key={`${person.name}-${index}`}><span>{person.name}</span><small>{person.active ? 'Đang hoạt động' : 'Đã tạm ngưng'}</small></li>)}</ul> : <p>Chưa có hồ sơ nhân viên.</p>}</section>
              <section><h3>Dịch vụ</h3>{tenantDetail.services.length ? <ul>{tenantDetail.services.map((service, index) => <li key={`${service.name}-${index}`}><span>{service.name} · {service.durationMinutes} phút · {(service.priceMinor / 100).toLocaleString('vi-VN')} {service.currency}</span><small>{service.active ? 'Đang hoạt động' : 'Đã tạm ngưng'}</small></li>)}</ul> : <p>Chưa có dịch vụ.</p>}</section>
            </div>
          </>}
        </section>
      </div>}
    </main>
  );
}
