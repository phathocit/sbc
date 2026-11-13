'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { BillingOrderDto, BillingProvider, PlanDto, TenantBillingDto, TenantContextDto } from '@sbc/contracts';
import { api } from '@/lib/api';
import { formatWorkspaceDate } from '@/lib/workspace-date';

const money = (value: number) => new Intl.NumberFormat('vi-VN').format(value) + ' ₫';
const date = (value: string) => formatWorkspaceDate(value);
const dateTime = (value: string) => formatWorkspaceDate(value, { includeTime: true });

export default function WorkspaceBillingPage() {
  const router = useRouter();
  const query = useSearchParams();
  const [tenantId, setTenantId] = useState('');
  const [context, setContext] = useState<TenantContextDto | null>(null);
  const [billing, setBilling] = useState<TenantBillingDto | null>(null);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [orders, setOrders] = useState<BillingOrderDto[]>([]);
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);
  const [providerChoicePlan, setProviderChoicePlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [billingClock, setBillingClock] = useState(() => Date.now());

  const refresh = useCallback(async (activeTenant: string) => {
    const [tenant, active, catalog, history] = await Promise.all([
      api.getCurrentTenant(activeTenant), api.currentBilling(activeTenant),
      api.listPlans(activeTenant), api.listBillingOrders(activeTenant),
    ]);
    setContext(tenant); setBilling(active); setPlans(catalog); setOrders(history);
    setBillingClock(Date.now());
  }, []);

  useEffect(() => {
    const savedTenant = localStorage.getItem('sbc_tenant_id');
    if (!savedTenant) { router.replace('/workspace'); return; }
    setTenantId(savedTenant);
    void refresh(savedTenant).then(() => setError('')).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Không tải được gói dịch vụ.');
    }).finally(() => setLoading(false));
  }, [router, refresh]);

  useEffect(() => {
    const orderId = query.get('orderId');
    if (query.get('payment') !== 'return' || !orderId || !tenantId) return;
    setMessage('Đang chờ cổng thanh toán xác nhận. Trang này chỉ đọc kết quả IPN phía máy chủ.');
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const order = await api.getBillingOrder(tenantId, orderId);
        setOrders((current) => [order, ...current.filter((item) => item.id !== order.id)]);
        if (order.status === 'paid') {
          setMessage('Thanh toán đã được xác nhận và gói dịch vụ đã cập nhật.');
          await refresh(tenantId);
          return true;
        }
        if (order.status === 'paid_review') {
          setMessage('Cổng xác nhận đã thu tiền. ZenBook đang đối soát giao dịch trước khi cập nhật gói.');
          return true;
        }
        if (order.status !== 'pending' || attempts >= 12) return true;
      } catch { if (attempts >= 12) return true; }
      return false;
    };
    let active = true;
    const run = async () => {
      while (active && attempts < 12) {
        if (await poll()) break;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    };
    void run();
    return () => { active = false; };
  }, [query, tenantId, refresh]);

  useEffect(() => {
    if (!tenantId || !billing || billing.plan.priceVnd <= 0) return;
    const delay = Math.min(Math.max(0, Date.parse(billing.periodEnd) - Date.now()) + 1000, 2_147_000_000);
    const timer = window.setTimeout(() => {
      setBillingClock(Date.now());
      void refresh(tenantId).then(() => setError('')).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Không cập nhật được trạng thái gói.');
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [billing, billingClock, tenantId, refresh]);

  async function startCheckout(planId: string, paymentProvider: BillingProvider) {
    if (!billing || !planId) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api.createBillingCheckout(tenantId, { planId, provider: paymentProvider });
      window.location.assign(result.checkoutUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không khởi tạo được giao dịch.');
      setBusy(false);
    }
  }

  async function copyOrderId(orderId: string) {
    try {
      await navigator.clipboard.writeText(orderId);
      setCopiedOrderId(orderId);
      window.setTimeout(() => setCopiedOrderId((current) => current === orderId ? null : current), 2200);
    } catch {
      setError('Không thể sao chép mã đơn. Hãy chọn và sao chép mã hiển thị bên cạnh.');
    }
  }

  if (loading) return <main className="app-page"><div className="app-container"><p className="notice">Đang tải thông tin gói…</p></div></main>;
  const owner = context?.role === 'owner';
  const paidPeriodActive = Boolean(billing && billing.plan.priceVnd > 0 && Date.parse(billing.periodEnd) > billingClock);
  const availableProviders: BillingProvider[] = billing
    ? (['vnpay', 'momo'] as const).filter((item) => billing.providers[item])
    : [];

  function choosePlanAndPay(planId: string) {
    if (!owner || paidPeriodActive) return;
    if (availableProviders.length === 0) {
      setError('Chưa có cổng thanh toán khả dụng. Liên hệ quản trị viên nền tảng.');
      return;
    }
    if (availableProviders.length === 1) {
      void startCheckout(planId, availableProviders[0]);
      return;
    }
    setProviderChoicePlan(planId);
  }

  return <main className="owner-page owner-billing"><div className="app-container billing-page">
    <header className="owner-page-heading"><h1>Gói dịch vụ của tiệm</h1></header>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}

    {billing && <section className="surface-card billing-current">
      <div><p className="eyebrow">GÓI HIỆN TẠI</p><h1 className="page-title">{billing.plan.displayName}</h1><p className="page-description">Hiệu lực đến {dateTime(billing.periodEnd)} · Không tự động gia hạn. Có thể gia hạn hoặc đổi gói sau khi kỳ hiện tại kết thúc.</p></div>
      <div className="billing-usage">
        <div><strong>{billing.usage.activeStaff} / {billing.plan.activeStaffLimit}</strong><span>Hồ sơ nhân viên đang hoạt động</span><progress max={Math.max(1, billing.plan.activeStaffLimit)} value={billing.usage.activeStaff} aria-label="Mức sử dụng hồ sơ nhân viên" /></div>
        <div><strong>{billing.usage.bookings} / {billing.usage.bookingLimit === null ? '∞' : billing.usage.bookingLimit}</strong><span>Lịch đặt trong kỳ hiện tại</span>{billing.usage.bookingLimit !== null && <progress max={Math.max(1, billing.usage.bookingLimit)} value={billing.usage.bookings} aria-label="Mức sử dụng lịch đặt trong kỳ" />}</div>
      </div>
    </section>}

    <section className="billing-section">
      <div className="billing-plan-grid">
        {plans.map((plan) => <article className={`surface-card billing-plan${billing?.plan.id === plan.id ? ' is-current' : ''}`} key={plan.id}>
          <div className="billing-plan-heading">
            <div className="billing-plan-kicker">{billing?.plan.id === plan.id && <p className="eyebrow">ĐANG SỬ DỤNG</p>}</div>
            <h3>{plan.displayName}</h3>
            <strong className="billing-price">{plan.priceVnd === 0 ? '0đ/tháng' : `${money(plan.priceVnd)} / tháng`}</strong>
          </div>
          <ul><li>Tối đa {plan.activeStaffLimit} hồ sơ nhân viên</li><li>{plan.monthlyBookingLimit === null ? 'Không giới hạn lịch đặt' : `${plan.monthlyBookingLimit} lịch đặt mỗi kỳ`}</li>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
          <div className="billing-plan-action">
            {owner && plan.priceVnd > 0 && <button className="button button-secondary" type="button" disabled={paidPeriodActive || busy || availableProviders.length === 0} onClick={() => choosePlanAndPay(plan.id)}>{paidPeriodActive ? `Khả dụng sau ${date(billing!.periodEnd)}` : availableProviders.length === 0 ? 'Chưa bật cổng thanh toán' : busy ? 'Đang chuyển…' : 'Chọn gói và thanh toán'}</button>}
          </div>
        </article>)}
      </div>
      {owner && availableProviders.length === 0 && <p className="helper-text">Chưa có cổng thanh toán khả dụng. Liên hệ quản trị viên nền tảng.</p>}
    </section>

    {!owner && <p className="helper-text">Chỉ chủ tiệm mới có thể thay đổi gói và khởi tạo thanh toán.</p>}

    <section className="surface-card stack-md billing-orders">
      <div><h2 className="surface-card-title">Lịch sử giao dịch</h2><p className="surface-card-description">Đơn đang chờ chưa làm thay đổi gói. Nếu đã thanh toán nhưng gói chưa cập nhật, chọn “Báo vấn đề thanh toán” ở giao dịch để gửi ticket kèm mã đơn.</p></div>
      {orders.length === 0 ? <p className="helper-text">Chưa có giao dịch.</p> : <div className="billing-order-list">{orders.map((order) => <div className="billing-order-row" key={order.id}><div className="billing-order-summary"><strong>{order.plan.displayName}</strong><span>{date(order.createdAt)} · {order.provider.toUpperCase()}</span><div className="billing-order-reference"><span>Mã đơn <code>{order.id}</code></span><button className="billing-copy-order" type="button" onClick={() => void copyOrderId(order.id)} aria-label={`Sao chép mã đơn ${order.id}`}>{copiedOrderId === order.id ? 'Đã sao chép' : 'Sao chép mã đơn'}</button></div></div><div><strong>{money(order.amountVnd)}</strong><span>{order.status === 'paid' ? 'Đã thanh toán' : order.status === 'pending' ? `Đang chờ · hết hạn ${date(order.expiresAt)}` : order.status}</span></div><div className="billing-order-actions">{owner && order.status === 'pending' && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void startCheckout(order.plan.id, order.provider)}>{busy ? 'Đang mở…' : 'Tiếp tục thanh toán'}</button>}{owner && <button className="button button-quiet" type="button" onClick={() => router.push(`/workspace/support?orderId=${encodeURIComponent(order.id)}`)}>Báo vấn đề thanh toán</button>}</div></div>)}</div>}
    </section>
    {providerChoicePlan && owner && <div className="billing-provider-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setProviderChoicePlan(null); }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) setProviderChoicePlan(null); }} tabIndex={-1}>
      <section className="billing-provider-modal" role="dialog" aria-modal="true" aria-labelledby="billing-provider-modal-title">
        <header><div><p className="eyebrow">THANH TOÁN GÓI</p><h2 id="billing-provider-modal-title">Chọn cổng thanh toán</h2><p>{plans.find((plan) => plan.id === providerChoicePlan)?.displayName}</p></div><button type="button" className="billing-provider-modal-close" aria-label="Đóng" disabled={busy} onClick={() => setProviderChoicePlan(null)}>×</button></header>
        <div className="billing-provider-modal-options">{availableProviders.map((item) => <button key={item} type="button" className="button button-secondary" disabled={busy} onClick={() => void startCheckout(providerChoicePlan, item)}>{busy ? 'Đang chuyển…' : `Thanh toán qua ${item === 'vnpay' ? 'VNPAY' : 'MoMo'}`}</button>)}</div>
      </section>
    </div>}
  </div></main>;
}
