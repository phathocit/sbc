import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ApplyLatePaymentRequest, AssignTenantPlanRequest, BillingCheckoutRequest, BillingOrderDto, BillingProvider, PlanDto, PlatformBillingFilters, PlatformBillingOrderDto, PlatformBillingOrderPageDto, PlatformBillingReconciliationDto, PlatformBillingSubscriptionDto, PlatformBillingSubscriptionPageDto, PlatformBillingSummaryDto, PlatformBillingRefundDto, ReconcileRefundDto, RefundPaymentRequest, PlatformPlanDto, TenantBillingDto, UpsertPlanRequest } from '@sbc/contracts';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';
import {
  billingOrders, memberships, paymentAttempts, paymentReconciliations, paymentRefundRequests, paymentWebhookEvents, planCatalog, staffProfiles,
  tenantBookingUsage, tenantSubscriptions, tenantPlanChanges, tenants, users,
} from '../../../../../packages/database/dist/schema/index.js';
import { db } from '../../database';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PasswordService } from '../../common/crypto/password.service';
import { publishTenantNotification } from '../tenant-notifications/tenant-notifications.service';

type VnpaySettings = NonNullable<NonNullable<Awaited<ReturnType<PlatformSettingsService['getDeliverySettings']>>['paymentProviders']>['vnpay']>;
type MomoSettings = NonNullable<NonNullable<Awaited<ReturnType<PlatformSettingsService['getDeliverySettings']>>['paymentProviders']>['momo']>;
type BillingSettings = Awaited<ReturnType<PlatformSettingsService['getDeliverySettings']>>;

function addMonth(from: Date): Date {
  const result = new Date(from);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function encodeQuery(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+').replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function vnpayCanonical(params: Record<string, string>): string {
  return Object.keys(params).sort().map((key) => `${encodeQuery(key)}=${encodeQuery(params[key])}`).join('&');
}

function vnpayDate(value: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

function parseVnpayDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{14}$/.test(value)) return null;
  const parsed = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+07:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function signatureMatches(provided: string, expected: string): boolean {
  if (!/^[a-f0-9]+$/i.test(provided) || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided.toLowerCase()), Buffer.from(expected.toLowerCase()));
}

function momoCanonical(data: Record<string, unknown>, keys: string[]): string {
  return keys.map((key) => `${key}=${String(data[key] ?? '')}`).join('&');
}

function billingPage(filters: PlatformBillingFilters): { page: number; pageSize: number; offset: number } {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  if (!Number.isInteger(page) || page < 1 || page > 100_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new BadRequestException('Invalid billing pagination.');
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function billingOwnerQuery() {
  return db.select({ tenantId: memberships.tenantId,
    ownerName: sql<string>`min(${users.displayName})`.as('owner_name'),
    ownerEmail: sql<string>`min(${users.email})`.as('owner_email'),
  }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.role, 'owner'), eq(memberships.status, 'active')))
    .groupBy(memberships.tenantId).as('billing_owner');
}

function billingDate(value: string | undefined, inclusiveEnd = false): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Billing dates must use YYYY-MM-DD.');
  const calendarDate = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== value) throw new BadRequestException('Invalid billing date.');
  const date = new Date(`${value}T00:00:00.000+07:00`);
  if (inclusiveEnd) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function vietnamDateString(date: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftCalendarDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function maskedReference(value: string | null): string | null {
  if (!value) return null;
  return `••••${value.slice(-6)}`;
}

@Injectable()
export class BillingService {
  constructor(
    @Inject(PlatformSettingsService) private readonly platformSettings: PlatformSettingsService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
  ) {}

  private async verifyPlatformPassword(userId: string, password: unknown): Promise<void> {
    if (typeof password !== 'string' || password.length < 1 || password.length > 1024) throw new ForbiddenException('Hãy xác thực lại mật khẩu quản trị.');
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.accountStatus !== 'active' || !user.passwordHash || !(await this.passwords.verifyPassword(password, user.passwordHash))) {
      throw new ForbiddenException('Mật khẩu quản trị không hợp lệ.');
    }
  }

  private async recordVerifiedVnpayPayment(config: VnpaySettings, source: 'IPN' | 'QueryDR'): Promise<void> {
    try {
      await this.platformSettings.recordVerifiedVnpayPayment(config, source);
    } catch {
      // Payment settlement is authoritative; stale admin diagnostics must not reject a verified provider callback.
    }
  }

  private planDto(row: typeof planCatalog.$inferSelect): PlanDto {
    return { id: row.id, code: row.code as PlanDto['code'], version: row.version, displayName: row.displayName,
      priceVnd: row.priceVnd, currency: 'VND', activeStaffLimit: row.activeStaffLimit, monthlyBookingLimit: row.monthlyBookingLimit,
      sortOrder: row.sortOrder, features: Array.isArray(row.features) ? row.features.filter((item): item is string => typeof item === 'string') : [] };
  }

  async listPlans(): Promise<PlanDto[]> {
    const rows = await db.select().from(planCatalog).where(eq(planCatalog.isActive, true)).orderBy(asc(planCatalog.sortOrder), asc(planCatalog.code), desc(planCatalog.version));
    const latest = new Map<string, typeof rows[number]>();
    for (const row of rows) if (!latest.has(row.code)) latest.set(row.code, row);
    return [...latest.values()].map((row) => this.planDto(row));
  }

  async listPlatformPlans(): Promise<PlatformPlanDto[]> {
    const rows = await db.select({ plan: planCatalog, subscriptionCount: sql<number>`count(*) FILTER (WHERE ${tenantSubscriptions.status} = 'active' AND ${tenantSubscriptions.currentPeriodEnd} > now())::int` })
      .from(planCatalog).leftJoin(tenantSubscriptions, eq(tenantSubscriptions.planId, planCatalog.id))
      .groupBy(planCatalog.id).orderBy(asc(planCatalog.sortOrder), asc(planCatalog.code), desc(planCatalog.version));
    return rows.map(({ plan, subscriptionCount }) => ({ ...this.planDto(plan), isActive: plan.isActive, subscriptionCount: Number(subscriptionCount) }));
  }

  async getPlatformBillingSummary(fromValue?: string, toValue?: string): Promise<PlatformBillingSummaryDto> {
    const now = new Date();
    const monthStart = new Date(now); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const revenueTo = toValue?.trim() || vietnamDateString(now);
    const revenueFrom = fromValue?.trim() || shiftCalendarDate(revenueTo, -29);
    const revenueStart = billingDate(revenueFrom)!;
    const revenueUntil = billingDate(revenueTo, true)!;
    const todayUntil = billingDate(vietnamDateString(now), true)!;
    if (revenueStart >= revenueUntil) throw new BadRequestException('Billing date range is invalid.');
    if (revenueUntil > todayUntil) throw new BadRequestException('Billing date range cannot include future dates.');
    const dayCount = Math.ceil((revenueUntil.getTime() - revenueStart.getTime()) / 86_400_000);
    if (dayCount > 3650) throw new BadRequestException('Billing overview range cannot exceed ten years.');
    const revenueGranularity: PlatformBillingSummaryDto['revenueGranularity'] = dayCount <= 31 ? 'day' : dayCount <= 730 ? 'month' : 'year';
    // Raw SQL placeholders do not carry Drizzle's timestamp encoder. postgres.js
    // cannot bind a Date object through that path, so pass explicit ISO values.
    const nowParam = now.toISOString();
    const monthStartParam = monthStart.toISOString();
    const [subscriptions] = await db.select({
      active: sql<number>`count(*) FILTER (WHERE ${tenantSubscriptions.status} = 'active' AND ${tenantSubscriptions.currentPeriodEnd} > now())::int`,
      pastDue: sql<number>`count(*) FILTER (WHERE ${tenantSubscriptions.status} = 'past_due' AND ${tenantSubscriptions.currentPeriodEnd} > now())::int`,
      expired: sql<number>`count(*) FILTER (WHERE ${tenantSubscriptions.status} = 'expired' OR ${tenantSubscriptions.currentPeriodEnd} <= now())::int`,
    }).from(tenantSubscriptions);
    const [orders] = await db.select({
      pending: sql<number>`count(*) FILTER (WHERE ${billingOrders.status} = 'pending' AND ${billingOrders.expiresAt} > now())::int`,
      stalePending: sql<number>`count(*) FILTER (WHERE ${billingOrders.status} = 'pending' AND ${billingOrders.expiresAt} <= now())::int`,
      failed: sql<number>`count(*) FILTER (WHERE ${billingOrders.status} = 'failed')::int`,
      expired: sql<number>`count(*) FILTER (WHERE ${billingOrders.status} = 'expired')::int`,
      paid: sql<number>`count(*) FILTER (WHERE ${billingOrders.status} = 'paid')::int`,
      paidReview: sql<number>`count(*) FILTER (WHERE ${billingOrders.status} = 'paid_review')::int`,
      refunded: sql<number>`count(*) FILTER (WHERE ${billingOrders.status} = 'refunded')::int`,
      paidTotal: sql<string>`coalesce(sum(${billingOrders.amountVnd}) FILTER (WHERE ${billingOrders.status} = 'paid'), 0)::text`,
      refundedTotal: sql<string>`coalesce(sum(${billingOrders.amountVnd}) FILTER (WHERE ${billingOrders.status} = 'refunded'), 0)::text`,
      paidThisMonth: sql<number>`count(*) FILTER (WHERE ${billingOrders.status} = 'paid' AND ${billingOrders.paidAt} >= ${monthStartParam} AND ${billingOrders.paidAt} <= ${nowParam})::int`,
      paidTotalThisMonth: sql<string>`coalesce(sum(${billingOrders.amountVnd}) FILTER (WHERE ${billingOrders.status} = 'paid' AND ${billingOrders.paidAt} >= ${monthStartParam} AND ${billingOrders.paidAt} <= ${nowParam}), 0)::text`,
    }).from(billingOrders);
    const [refunds] = await db.select({
      pending: sql<number>`count(*) FILTER (WHERE ${paymentRefundRequests.status} IN ('started', 'pending', 'unknown'))::int`,
    }).from(paymentRefundRequests);
    const revenueBucket = revenueGranularity === 'day'
      ? sql`date_trunc('day', ${billingOrders.paidAt} AT TIME ZONE 'Asia/Ho_Chi_Minh')`
      : revenueGranularity === 'month'
        ? sql`date_trunc('month', ${billingOrders.paidAt} AT TIME ZONE 'Asia/Ho_Chi_Minh')`
        : sql`date_trunc('year', ${billingOrders.paidAt} AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
    const revenuePeriod = revenueGranularity === 'day'
      ? sql<string>`to_char(${revenueBucket}, 'YYYY-MM-DD')`.as('period')
      : revenueGranularity === 'month'
        ? sql<string>`to_char(${revenueBucket}, 'YYYY-MM')`.as('period')
        : sql<string>`to_char(${revenueBucket}, 'YYYY')`.as('period');
    const [monthlyRevenueRows, tenantPlanRows] = await Promise.all([
      db.select({
        period: revenuePeriod,
        orderCount: sql<number>`count(*)::int`.as('order_count'),
        amountVnd: sql<string>`coalesce(sum(${billingOrders.amountVnd}), 0)::text`.as('amount_vnd'),
      }).from(billingOrders)
        .where(and(eq(billingOrders.status, 'paid'), gte(billingOrders.paidAt, revenueStart), lt(billingOrders.paidAt, revenueUntil)))
        .groupBy(revenueBucket).orderBy(revenueBucket),
      db.select({
        planCode: planCatalog.code,
        planName: sql<string>`max(${planCatalog.displayName})`.as('plan_name'),
        tenantCount: sql<number>`count(DISTINCT ${tenantSubscriptions.tenantId})::int`.as('tenant_count'),
      }).from(tenantSubscriptions)
        .innerJoin(planCatalog, eq(tenantSubscriptions.planId, planCatalog.id))
        .groupBy(planCatalog.code).orderBy(asc(planCatalog.code)),
    ]);
    const revenueByPeriod = new Map(monthlyRevenueRows.map((row) => [row.period, row]));
    const revenuePeriods: string[] = [];
    if (revenueGranularity === 'day') {
      const cursor = new Date(`${revenueFrom}T00:00:00.000Z`);
      const last = new Date(`${revenueTo}T00:00:00.000Z`);
      while (cursor <= last) { revenuePeriods.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
    } else if (revenueGranularity === 'month') {
      const [fromYear, fromMonth] = revenueFrom.split('-').map(Number);
      const [toYear, toMonth] = revenueTo.split('-').map(Number);
      const cursor = new Date(Date.UTC(fromYear, fromMonth - 1, 1));
      const last = new Date(Date.UTC(toYear, toMonth - 1, 1));
      while (cursor <= last) { revenuePeriods.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
    } else {
      const fromYear = Number(revenueFrom.slice(0, 4));
      const toYear = Number(revenueTo.slice(0, 4));
      for (let year = fromYear; year <= toYear; year += 1) revenuePeriods.push(String(year));
    }
    const revenueSeries = revenuePeriods.map((period) => {
      const row = revenueByPeriod.get(period);
      return { period, orderCount: Number(row?.orderCount ?? 0), amountVnd: row?.amountVnd ?? '0' };
    });
    return {
      activeSubscriptions: Number(subscriptions?.active ?? 0), pastDueSubscriptions: Number(subscriptions?.pastDue ?? 0),
      expiredSubscriptions: Number(subscriptions?.expired ?? 0), pendingOrders: Number(orders?.pending ?? 0),
      stalePendingOrders: Number(orders?.stalePending ?? 0), failedOrders: Number(orders?.failed ?? 0), expiredOrders: Number(orders?.expired ?? 0),
      paidReviewOrders: Number(orders?.paidReview ?? 0), refundPendingOrders: Number(refunds?.pending ?? 0),
      refundedOrders: Number(orders?.refunded ?? 0), refundedTotalVnd: orders?.refundedTotal ?? '0',
      paidOrders: Number(orders?.paid ?? 0), paidTotalVnd: orders?.paidTotal ?? '0',
      paidOrdersThisMonth: Number(orders?.paidThisMonth ?? 0), paidTotalThisMonthVnd: orders?.paidTotalThisMonth ?? '0',
      revenueFrom, revenueTo, revenueGranularity, revenueSeries,
      tenantPlanDistribution: tenantPlanRows.map((row) => ({ planCode: row.planCode, planName: row.planName, tenantCount: Number(row.tenantCount) })),
    };
  }

  async listPlatformBillingSubscriptions(filters: PlatformBillingFilters): Promise<PlatformBillingSubscriptionPageDto> {
    const { page, pageSize, offset } = billingPage(filters);
    const owner = billingOwnerQuery();
    const conditions = [];
    const search = filters.search?.trim();
    if (search && search.length > 120) throw new BadRequestException('Billing search is too long.');
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(or(ilike(tenants.displayName, pattern), ilike(tenants.slug, pattern), ilike(owner.ownerName, pattern), ilike(owner.ownerEmail, pattern)));
    }
    if (filters.planCode) {
      if (!/^[a-z0-9][a-z0-9_-]{0,23}$/.test(filters.planCode)) throw new BadRequestException('Invalid plan code filter.');
      conditions.push(eq(planCatalog.code, filters.planCode));
    }
    if (filters.status) {
      if (!['active', 'past_due', 'expired'].includes(filters.status)) throw new BadRequestException('Invalid subscription status filter.');
      const effectiveStatus = sql<string>`CASE WHEN ${tenantSubscriptions.status} = 'past_due' AND ${tenantSubscriptions.currentPeriodEnd} > now() THEN 'past_due' WHEN ${tenantSubscriptions.status} = 'active' AND ${tenantSubscriptions.currentPeriodEnd} > now() THEN 'active' ELSE 'expired' END`;
      conditions.push(sql`${effectiveStatus} = ${filters.status}`);
    }
    const where = and(...conditions);
    const [totalRow] = await db.select({ total: sql<number>`count(*)::int` }).from(tenantSubscriptions)
      .innerJoin(tenants, eq(tenantSubscriptions.tenantId, tenants.id)).innerJoin(planCatalog, eq(tenantSubscriptions.planId, planCatalog.id))
      .leftJoin(owner, eq(owner.tenantId, tenants.id)).where(where);
    const rows = await db.select({
      subscription: tenantSubscriptions, tenant: tenants, plan: planCatalog, ownerName: owner.ownerName, ownerEmail: owner.ownerEmail,
      activeStaff: sql<number>`(SELECT count(*)::int FROM staff_profiles WHERE tenant_id = ${tenantSubscriptions.tenantId} AND active = true)`,
      bookings: sql<number>`coalesce(${tenantBookingUsage.bookingCount}, 0)::int`,
    }).from(tenantSubscriptions).innerJoin(tenants, eq(tenantSubscriptions.tenantId, tenants.id))
      .innerJoin(planCatalog, eq(tenantSubscriptions.planId, planCatalog.id)).leftJoin(owner, eq(owner.tenantId, tenants.id))
      .leftJoin(tenantBookingUsage, and(eq(tenantBookingUsage.tenantId, tenantSubscriptions.tenantId), eq(tenantBookingUsage.periodStart, tenantSubscriptions.currentPeriodStart)))
      .where(where).orderBy(desc(tenantSubscriptions.updatedAt), asc(tenants.displayName)).limit(pageSize).offset(offset);
    const now = Date.now();
    const items: PlatformBillingSubscriptionDto[] = rows.map(({ subscription, tenant, plan, ownerName, ownerEmail, activeStaff, bookings }) => ({
      tenantId: tenant.id, tenantName: tenant.displayName, tenantSlug: tenant.slug, tenantStatus: tenant.status,
      ownerName: ownerName ?? null, ownerEmail: ownerEmail ?? null, planId: plan.id, planCode: plan.code,
      planName: plan.displayName, planVersion: plan.version, priceVnd: plan.priceVnd,
      status: subscription.currentPeriodEnd.getTime() <= now || subscription.status === 'expired' ? 'expired' : subscription.status as PlatformBillingSubscriptionDto['status'],
      periodStart: subscription.currentPeriodStart.toISOString(), periodEnd: subscription.currentPeriodEnd.toISOString(),
      activeStaff: Number(activeStaff), staffLimit: plan.activeStaffLimit, bookings: Number(bookings), bookingLimit: plan.monthlyBookingLimit,
    }));
    return { items, total: Number(totalRow?.total ?? 0), page, pageSize };
  }

  async listPlatformBillingOrders(filters: PlatformBillingFilters, reconciliationOnly = false): Promise<PlatformBillingOrderPageDto> {
    const { page, pageSize, offset } = billingPage(filters);
    const owner = billingOwnerQuery();
    const conditions = [];
    const search = filters.search?.trim();
    if (search && search.length > 120) throw new BadRequestException('Billing search is too long.');
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(or(ilike(tenants.displayName, pattern), ilike(tenants.slug, pattern), ilike(owner.ownerName, pattern), ilike(owner.ownerEmail, pattern)));
    }
    if (filters.planCode) {
      if (!/^[a-z0-9][a-z0-9_-]{0,23}$/.test(filters.planCode)) throw new BadRequestException('Invalid plan code filter.');
      conditions.push(eq(planCatalog.code, filters.planCode));
    }
    if (reconciliationOnly) {
      conditions.push(or(
        inArray(billingOrders.status, ['failed', 'expired', 'paid_review']),
        and(eq(billingOrders.status, 'pending'), lte(billingOrders.expiresAt, new Date())),
      ));
    } else if (filters.status) {
      if (!['pending', 'paid', 'paid_review', 'failed', 'expired', 'cancelled', 'refunded'].includes(filters.status)) throw new BadRequestException('Invalid order status filter.');
      conditions.push(eq(billingOrders.status, filters.status));
    }
    if (!reconciliationOnly && filters.provider) {
      if (!['vnpay', 'momo'].includes(filters.provider)) throw new BadRequestException('Invalid payment provider filter.');
      conditions.push(eq(billingOrders.provider, filters.provider));
    }
    const from = billingDate(filters.from);
    const until = billingDate(filters.to, true);
    if (from && until && from >= until) throw new BadRequestException('Billing date range is invalid.');
    if (from) conditions.push(gte(billingOrders.createdAt, from));
    if (until) conditions.push(lt(billingOrders.createdAt, until));
    const where = and(...conditions);
    const [totalRow] = await db.select({ total: sql<number>`count(*)::int` }).from(billingOrders)
      .innerJoin(tenants, eq(billingOrders.tenantId, tenants.id)).innerJoin(planCatalog, eq(billingOrders.targetPlanId, planCatalog.id))
      .leftJoin(owner, eq(owner.tenantId, tenants.id)).where(where);
    const rows = await db.select({ order: billingOrders, tenant: tenants, plan: planCatalog, ownerName: owner.ownerName, ownerEmail: owner.ownerEmail })
      .from(billingOrders).innerJoin(tenants, eq(billingOrders.tenantId, tenants.id))
      .innerJoin(planCatalog, eq(billingOrders.targetPlanId, planCatalog.id)).leftJoin(owner, eq(owner.tenantId, tenants.id))
      .where(where).orderBy(desc(billingOrders.createdAt), desc(billingOrders.id)).limit(pageSize).offset(offset);
    const ids = rows.map(({ order }) => order.id);
    const attempts = ids.length ? await db.select().from(paymentAttempts).where(inArray(paymentAttempts.orderId, ids)).orderBy(desc(paymentAttempts.createdAt)) : [];
    const events = ids.length ? await db.select({ id: paymentWebhookEvents.id, orderId: paymentWebhookEvents.orderId,
      status: paymentWebhookEvents.status, signatureVerified: paymentWebhookEvents.signatureVerified,
      receivedAt: paymentWebhookEvents.receivedAt, processedAt: paymentWebhookEvents.processedAt,
    }).from(paymentWebhookEvents).where(inArray(paymentWebhookEvents.orderId, ids)).orderBy(desc(paymentWebhookEvents.receivedAt)) : [];
    const refunds = ids.length ? await db.select().from(paymentRefundRequests).where(inArray(paymentRefundRequests.orderId, ids)).orderBy(desc(paymentRefundRequests.requestedAt)) : [];
    const latestAttempt = new Map<string, typeof attempts[number]>();
    for (const attempt of attempts) if (!latestAttempt.has(attempt.orderId)) latestAttempt.set(attempt.orderId, attempt);
    const latestEvent = new Map<string, typeof events[number]>();
    for (const event of events) if (!latestEvent.has(event.orderId)) latestEvent.set(event.orderId, event);
    const latestRefund = new Map<string, typeof refunds[number]>();
    for (const refund of refunds) if (!latestRefund.has(refund.orderId)) latestRefund.set(refund.orderId, refund);
    const items: PlatformBillingOrderDto[] = rows.map(({ order, tenant, plan, ownerName, ownerEmail }) => {
      const attempt = latestAttempt.get(order.id);
      const event = latestEvent.get(order.id);
      const refund = latestRefund.get(order.id);
      return {
        id: order.id, tenantId: tenant.id, tenantName: tenant.displayName, tenantSlug: tenant.slug,
        ownerName: ownerName ?? null, ownerEmail: ownerEmail ?? null, planCode: plan.code, planName: plan.displayName,
        planVersion: plan.version, provider: order.provider as BillingProvider, amountVnd: order.amountVnd, currency: 'VND',
        status: order.status as PlatformBillingOrderDto['status'], createdAt: order.createdAt.toISOString(), expiresAt: order.expiresAt.toISOString(),
        paidAt: order.paidAt?.toISOString() ?? null,
        attempt: attempt ? { status: attempt.status, transactionReference: maskedReference(attempt.providerTransactionId),
          createdAt: attempt.createdAt.toISOString(), completedAt: attempt.completedAt?.toISOString() ?? null } : null,
        webhook: event ? { status: event.status, signatureVerified: event.signatureVerified,
          receivedAt: event.receivedAt.toISOString(), processedAt: event.processedAt?.toISOString() ?? null } : null,
        refund: refund ? { id: refund.id, status: refund.status as NonNullable<PlatformBillingOrderDto['refund']>['status'],
          amountVnd: refund.amountVnd, reason: refund.reason, providerReference: maskedReference(refund.providerTransactionId),
          message: refund.message ?? null, requestedAt: refund.requestedAt.toISOString(), completedAt: refund.completedAt?.toISOString() ?? null } : null,
      };
    });
    return { items, total: Number(totalRow?.total ?? 0), page, pageSize };
  }

  async listPlatformBillingReconciliationOrders(filters: PlatformBillingFilters): Promise<PlatformBillingOrderDto[]> {
    const result = await this.listPlatformBillingOrders({ ...filters, status: undefined, provider: undefined, page: 1, pageSize: 5 }, true);
    return result.items;
  }

  private refundDto(refund: typeof paymentRefundRequests.$inferSelect, order: typeof billingOrders.$inferSelect): PlatformBillingRefundDto {
    return {
      orderId: order.id, refundId: refund.id,
      status: refund.status === 'started' ? 'pending' : refund.status as PlatformBillingRefundDto['status'],
      amountVnd: refund.amountVnd, provider: order.provider as BillingProvider,
      message: refund.message ?? 'Yêu cầu hoàn tiền đã được lưu.', completedAt: refund.completedAt?.toISOString() ?? null,
    };
  }

  private async finishRefund(refundId: string, status: 'pending' | 'succeeded' | 'failed' | 'unknown', responseCode: string | null,
    transactionStatus: string | null, providerTransactionId: string | null, message: string): Promise<PlatformBillingRefundDto> {
    const [initial] = await db.select({ orderId: paymentRefundRequests.orderId }).from(paymentRefundRequests)
      .where(eq(paymentRefundRequests.id, refundId)).limit(1);
    if (!initial) throw new NotFoundException('Refund request not found');
    const [orderInitial] = await db.select().from(billingOrders).where(eq(billingOrders.id, initial.orderId)).limit(1);
    if (!orderInitial) throw new NotFoundException('Payment order not found');
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${orderInitial.tenantId}`}, 0))`);
      const [order] = await tx.select().from(billingOrders).where(eq(billingOrders.id, orderInitial.id)).for('update').limit(1);
      const [refund] = await tx.select().from(paymentRefundRequests).where(eq(paymentRefundRequests.id, refundId)).for('update').limit(1);
      if (!order || !refund) throw new NotFoundException('Refund request not found');
      if (refund.status === 'succeeded' || order.status === 'refunded') return { refund, order };
      const completedAt = status === 'succeeded' || status === 'failed' ? now : null;
      const [updatedRefund] = await tx.update(paymentRefundRequests).set({ status, responseCode: responseCode?.slice(0, 32) ?? null,
        transactionStatus: transactionStatus?.slice(0, 32) ?? null, providerTransactionId: providerTransactionId?.slice(0, 128) ?? null,
        message: message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255), completedAt })
        .where(eq(paymentRefundRequests.id, refundId)).returning();
      if (status === 'succeeded') {
        if (!['paid', 'paid_review', 'refunded'].includes(order.status)) throw new ConflictException('Đơn không còn ở trạng thái có thể hoàn tiền.');
        await tx.update(billingOrders).set({ status: 'refunded', updatedAt: now }).where(eq(billingOrders.id, order.id));
      }
      return { refund: updatedRefund, order: status === 'succeeded' ? { ...order, status: 'refunded' } : order };
    });
    return this.refundDto(result.refund, result.order);
  }

  async requestFullRefund(orderId: string, adminUserId: string, input: RefundPaymentRequest): Promise<PlatformBillingRefundDto> {
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < 3 || reason.length > 500) throw new BadRequestException('Lý do hoàn tiền cần từ 3 đến 500 ký tự.');
    await this.verifyPlatformPassword(adminUserId, input?.currentPassword);
    const settings = await this.platformSettings.getDeliverySettings();
    const orderSnapshot = await db.select().from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1).then((rows) => rows[0]);
    if (!orderSnapshot) throw new NotFoundException('Payment order not found');
    const providerConfig = orderSnapshot.provider === 'vnpay' ? settings.paymentProviders?.vnpay : settings.paymentProviders?.momo;
    const credentialsReady = orderSnapshot.provider === 'vnpay'
      ? Boolean(providerConfig && 'tmnCode' in providerConfig && providerConfig.tmnCode && providerConfig.hashSecret)
      : Boolean(providerConfig && 'partnerCode' in providerConfig && providerConfig.partnerCode && providerConfig.accessKey && providerConfig.secretKey);
    if (!credentialsReady) throw new ServiceUnavailableException('Payment provider credentials are not configured');

    const requestId = randomUUID().replaceAll('-', '');
    const refundOrderId = randomUUID().replaceAll('-', '');
    const [storedRefund, order, attempt, providerPaidAt] = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${orderSnapshot.tenantId}`}, 0))`);
      const [order] = await tx.select().from(billingOrders).where(eq(billingOrders.id, orderId)).for('update').limit(1);
      if (!order) throw new NotFoundException('Payment order not found');
      if (!['paid', 'paid_review'].includes(order.status)) throw new ConflictException('Chỉ đơn đã thanh toán hoặc đang chờ xử lý thủ công mới được hoàn tiền.');
      const [existingRefund] = await tx.select().from(paymentRefundRequests).where(eq(paymentRefundRequests.orderId, order.id))
        .orderBy(desc(paymentRefundRequests.requestedAt)).limit(1);
      if (existingRefund && ['started', 'pending', 'unknown', 'succeeded'].includes(existingRefund.status)) {
        throw new ConflictException('Đơn đã có yêu cầu hoàn tiền đang mở hoặc đã hoàn tất. Hãy đối soát yêu cầu hiện tại.');
      }
      if (order.status === 'paid') {
        const [subscription] = await tx.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, order.tenantId)).for('update').limit(1);
        if (subscription?.planId === order.targetPlanId && subscription.status !== 'expired' && subscription.currentPeriodEnd > new Date()) {
          throw new ConflictException('Không thể hoàn tiền khi gói từ giao dịch này vẫn đang cấp quyền sử dụng. Hãy xử lý sau khi kỳ kết thúc hoặc chuyển sang bộ phận hỗ trợ.');
        }
        const [newerOrder] = await tx.select({ id: billingOrders.id }).from(billingOrders).where(and(
          eq(billingOrders.tenantId, order.tenantId), sql`${billingOrders.id} <> ${order.id}`,
          inArray(billingOrders.status, ['pending', 'paid', 'paid_review']),
        )).limit(1);
        const [newerPlanChange] = await tx.select({ id: tenantPlanChanges.id }).from(tenantPlanChanges).where(and(
          eq(tenantPlanChanges.tenantId, order.tenantId), gte(tenantPlanChanges.changedAt, order.paidAt ?? order.createdAt),
        )).limit(1);
        if (newerOrder || newerPlanChange) throw new ConflictException('Đơn có giao dịch hoặc thay đổi gói liên quan mới hơn; cần đối soát thủ công trước khi hoàn tiền.');
      }
      const [attempt] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, order.id)).orderBy(desc(paymentAttempts.createdAt)).limit(1);
      if (!attempt?.providerTransactionId) throw new ConflictException('Thiếu mã giao dịch gốc từ cổng thanh toán; chưa thể gửi yêu cầu hoàn tiền.');
      const [paymentEvent] = order.provider === 'vnpay' ? await tx.select({ payload: paymentWebhookEvents.payload }).from(paymentWebhookEvents)
        .where(and(eq(paymentWebhookEvents.orderId, order.id), eq(paymentWebhookEvents.provider, 'vnpay'))).orderBy(desc(paymentWebhookEvents.receivedAt)).limit(1) : [];
      const providerEventPayload = paymentEvent?.payload as Record<string, unknown> | undefined;
      const providerPaidAt = attempt.providerPaidAt ?? parseVnpayDate(providerEventPayload?.vnp_PayDate) ?? attempt.completedAt ?? order.createdAt;
      if (order.provider === 'vnpay' && !attempt.providerPaidAt) await tx.update(paymentAttempts).set({ providerPaidAt }).where(eq(paymentAttempts.id, attempt.id));
      const [created] = await tx.insert(paymentRefundRequests).values({ orderId: order.id, provider: order.provider,
        providerRequestId: requestId, providerRefundOrderId: refundOrderId, amountVnd: order.amountVnd, reason,
        initiatedBy: adminUserId, status: 'started' }).returning();
      return [created, order, attempt, providerPaidAt] as const;
    });
    try {
      if (order.provider === 'momo') {
        const config = settings.paymentProviders!.momo!;
        if (!config.partnerCode || !config.accessKey || !config.secretKey) throw new ServiceUnavailableException('MoMo credentials are not configured');
        if (!/^\d+$/.test(attempt.providerTransactionId!)) return this.finishRefund(storedRefund.id, 'failed', null, null, null, 'Mã giao dịch MoMo không hợp lệ để hoàn tiền.');
        const payload = { partnerCode: config.partnerCode, orderId: storedRefund.providerRefundOrderId,
          requestId: storedRefund.providerRequestId, amount: storedRefund.amountVnd, transId: attempt.providerTransactionId,
          lang: 'vi', description: reason.slice(0, 200) };
        const canonical = `accessKey=${config.accessKey}&amount=${payload.amount}&description=${payload.description}&orderId=${payload.orderId}&partnerCode=${config.partnerCode}&requestId=${payload.requestId}&transId=${payload.transId}`;
        const apiHost = config.mode === 'sandbox' ? 'https://test-payment.momo.vn' : 'https://payment.momo.vn';
        const response = await fetch(`${apiHost}/v2/gateway/api/refund`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, signature: createHmac('sha256', config.secretKey).update(canonical).digest('hex') }), signal: AbortSignal.timeout(30_000) });
        const result = await response.json() as Record<string, unknown>;
        const code = String(result.resultCode ?? response.status);
        if (!response.ok || result.partnerCode !== config.partnerCode || result.orderId !== payload.orderId
          || result.requestId !== payload.requestId || Number(result.amount) !== payload.amount) {
          return this.finishRefund(storedRefund.id, response.ok ? 'unknown' : 'unknown', code, null, null, 'Phản hồi MoMo không khớp hoặc chưa xác định được kết quả; hãy truy vấn yêu cầu hoàn tiền hiện tại.');
        }
        const status = Number(result.resultCode) === 0 ? 'succeeded' : [7000, 7002].includes(Number(result.resultCode)) ? 'pending' : 'unknown';
        return this.finishRefund(storedRefund.id, status, code, null, String(result.transId ?? '') || null,
          typeof result.message === 'string' ? result.message : status === 'succeeded' ? 'MoMo xác nhận hoàn tiền thành công.' : 'MoMo chưa chấp nhận hoàn tiền.');
      }

      const config = settings.paymentProviders!.vnpay!;
      if (!config.tmnCode || !config.hashSecret) throw new ServiceUnavailableException('VNPAY credentials are not configured');
      const requestedAt = new Date();
      const requestFields = {
        vnp_RequestId: storedRefund.providerRequestId, vnp_Version: '2.1.0', vnp_Command: 'refund', vnp_TmnCode: config.tmnCode,
        vnp_TransactionType: '02', vnp_TxnRef: order.orderReference, vnp_Amount: String(order.amountVnd * 100),
        vnp_TransactionNo: attempt.providerTransactionId!, vnp_TransactionDate: vnpayDate(providerPaidAt),
        vnp_CreateBy: `platform-${adminUserId.slice(0, 8)}`, vnp_CreateDate: vnpayDate(requestedAt),
        vnp_IpAddr: process.env.PAYMENTS_SERVER_IP || '127.0.0.1', vnp_OrderInfo: reason.slice(0, 200),
      };
      const checksum = [requestFields.vnp_RequestId, requestFields.vnp_Version, requestFields.vnp_Command, requestFields.vnp_TmnCode,
        requestFields.vnp_TransactionType, requestFields.vnp_TxnRef, requestFields.vnp_Amount, requestFields.vnp_TransactionNo,
        requestFields.vnp_TransactionDate, requestFields.vnp_CreateBy, requestFields.vnp_CreateDate, requestFields.vnp_IpAddr,
        requestFields.vnp_OrderInfo].join('|');
      const apiUrl = config.mode === 'sandbox' ? 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction' : 'https://pay.vnpay.vn/merchant_webapi/api/transaction';
      const response = await fetch(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...requestFields, vnp_SecureHash: createHmac('sha512', config.hashSecret).update(checksum).digest('hex') }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json() as Record<string, unknown>;
      const field = (key: string) => typeof result[key] === 'string' ? result[key] as string : '';
      const responseFields = ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount',
        'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo'].map(field);
      const valid = response.ok && signatureMatches(field('vnp_SecureHash'), createHmac('sha512', config.hashSecret).update(responseFields.join('|')).digest('hex'))
        && field('vnp_TmnCode') === config.tmnCode && field('vnp_TxnRef') === order.orderReference && Number(field('vnp_Amount')) === order.amountVnd * 100;
      if (!valid) return this.finishRefund(storedRefund.id, 'unknown', field('vnp_ResponseCode') || String(response.status), field('vnp_TransactionStatus') || null,
        field('vnp_TransactionNo') || null, 'Phản hồi VNPAY không xác thực được; hãy truy vấn yêu cầu hoàn tiền hiện tại.');
      const responseCode = field('vnp_ResponseCode');
      const transactionStatus = field('vnp_TransactionStatus');
      const status = responseCode === '00' && field('vnp_TransactionType') === '02' && transactionStatus === '00' ? 'succeeded'
        : responseCode === '94' || responseCode === '00' ? 'pending'
          : ['02', '03', '91', '95', '97'].includes(responseCode) ? 'failed' : 'unknown';
      return this.finishRefund(storedRefund.id, status, responseCode, transactionStatus, field('vnp_TransactionNo') || null,
        field('vnp_Message') || (status === 'succeeded' ? 'VNPAY xác nhận hoàn tiền thành công.' : status === 'pending' ? 'VNPAY đang xử lý hoàn tiền.' : 'VNPAY từ chối yêu cầu hoàn tiền.'));
    } catch {
      return this.finishRefund(storedRefund.id, 'unknown', null, null, null, 'Chưa nhận được kết quả chắc chắn từ cổng thanh toán; hãy truy vấn yêu cầu hoàn tiền, không gửi yêu cầu mới.');
    }
  }

  async reconcileRefund(orderId: string, refundId: string, adminUserId: string, currentPassword: string): Promise<ReconcileRefundDto> {
    await this.verifyPlatformPassword(adminUserId, currentPassword);
    const [refund] = await db.select().from(paymentRefundRequests).where(and(eq(paymentRefundRequests.id, refundId), eq(paymentRefundRequests.orderId, orderId))).limit(1);
    const [order] = await db.select().from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1);
    if (!refund || !order) throw new NotFoundException('Refund request not found');
    if (refund.status === 'succeeded' || refund.status === 'failed') return this.refundDto(refund, order);
    const settings = await this.platformSettings.getDeliverySettings();
    try {
      if (refund.provider === 'momo') {
        const config = settings.paymentProviders?.momo;
        if (!config?.partnerCode || !config.accessKey || !config.secretKey) throw new ServiceUnavailableException('MoMo credentials are not configured');
        const request = { partnerCode: config.partnerCode, requestId: refund.providerRequestId, orderId: refund.providerRefundOrderId, lang: 'vi' };
        const canonical = `accessKey=${config.accessKey}&orderId=${request.orderId}&partnerCode=${config.partnerCode}&requestId=${request.requestId}`;
        const apiHost = config.mode === 'sandbox' ? 'https://test-payment.momo.vn' : 'https://payment.momo.vn';
        const response = await fetch(`${apiHost}/v2/gateway/api/refund/query`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...request, signature: createHmac('sha256', config.secretKey).update(canonical).digest('hex') }), signal: AbortSignal.timeout(30_000) });
        const result = await response.json() as Record<string, unknown>;
        if (!response.ok || result.partnerCode !== config.partnerCode || result.requestId !== refund.providerRequestId || result.orderId !== refund.providerRefundOrderId) {
          const unresolved = await this.finishRefund(refund.id, 'unknown', String(result.resultCode ?? response.status), null, null, 'MoMo chưa trả về kết quả đối soát khớp.');
          return { ...unresolved, message: unresolved.message };
        }
        const refundRows = Array.isArray(result.refundTrans) ? result.refundTrans as Array<Record<string, unknown>> : [];
        const matching = refundRows.find((item) => item.orderId === refund.providerRefundOrderId);
        if (!matching) {
          const unresolved = await this.finishRefund(refund.id, 'unknown', String(result.resultCode ?? ''), null, null, 'MoMo chưa có bản ghi hoàn tiền khớp; yêu cầu vẫn cần theo dõi.');
          return unresolved;
        }
        const code = Number(matching.resultCode);
        const status = code === 0 && Number(matching.amount) === refund.amountVnd ? 'succeeded' : [7000, 7002].includes(code) ? 'pending' : 'unknown';
        return this.finishRefund(refund.id, status, String(matching.resultCode ?? ''), null, String(matching.transId ?? '') || null,
          status === 'succeeded' ? 'MoMo xác nhận hoàn tiền thành công.' : status === 'pending' ? 'MoMo vẫn đang xử lý hoàn tiền.' : 'MoMo xác nhận giao dịch hoàn tiền thất bại.');
      }

      const config = settings.paymentProviders?.vnpay;
      if (!config?.tmnCode || !config.hashSecret) throw new ServiceUnavailableException('VNPAY credentials are not configured');
      const [attempt] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, order.id)).orderBy(desc(paymentAttempts.createdAt)).limit(1);
      if (!attempt?.providerTransactionId) throw new ConflictException('Thiếu mã giao dịch gốc để truy vấn hoàn tiền.');
      const requestedAt = new Date();
      const fields = { vnp_RequestId: randomUUID().replaceAll('-', ''), vnp_Version: '2.1.0', vnp_Command: 'querydr', vnp_TmnCode: config.tmnCode,
        vnp_TxnRef: order.orderReference, vnp_TransactionDate: vnpayDate(attempt.providerPaidAt ?? order.createdAt), vnp_CreateDate: vnpayDate(requestedAt),
        vnp_IpAddr: process.env.PAYMENTS_SERVER_IP || '127.0.0.1', vnp_OrderInfo: `Refund status ${refund.providerRefundOrderId}` };
      const checksum = [fields.vnp_RequestId, fields.vnp_Version, fields.vnp_Command, fields.vnp_TmnCode, fields.vnp_TxnRef,
        fields.vnp_TransactionDate, fields.vnp_CreateDate, fields.vnp_IpAddr, fields.vnp_OrderInfo].join('|');
      const apiUrl = config.mode === 'sandbox' ? 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction' : 'https://pay.vnpay.vn/merchant_webapi/api/transaction';
      const response = await fetch(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...fields, vnp_SecureHash: createHmac('sha512', config.hashSecret).update(checksum).digest('hex') }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json() as Record<string, unknown>;
      const field = (key: string) => typeof result[key] === 'string' ? result[key] as string : '';
      const responseFields = ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo', 'vnp_PromotionCode', 'vnp_PromotionAmount'].map(field);
      const valid = response.ok && signatureMatches(field('vnp_SecureHash'), createHmac('sha512', config.hashSecret).update(responseFields.join('|')).digest('hex'))
        && field('vnp_TmnCode') === config.tmnCode && field('vnp_TxnRef') === order.orderReference && Number(field('vnp_Amount')) === order.amountVnd * 100;
      if (!valid) return this.finishRefund(refund.id, 'unknown', field('vnp_ResponseCode') || String(response.status), field('vnp_TransactionStatus') || null, null, 'VNPAY chưa trả về phản hồi đối soát hợp lệ.');
      const type = field('vnp_TransactionType');
      const transactionStatus = field('vnp_TransactionStatus');
      const status = field('vnp_ResponseCode') !== '00' ? 'unknown'
        : type === '02' && transactionStatus === '00' ? 'succeeded'
          : type === '02' && ['05', '06'].includes(transactionStatus) ? 'pending'
            : type === '02' && transactionStatus === '02' ? 'failed' : 'unknown';
      return this.finishRefund(refund.id, status, field('vnp_ResponseCode'), transactionStatus, field('vnp_TransactionNo') || null,
        status === 'succeeded' ? 'VNPAY xác nhận đã hoàn tiền.' : status === 'pending' ? 'VNPAY vẫn đang xử lý hoàn tiền.' : status === 'failed' ? 'VNPAY xác nhận hoàn tiền thất bại.' : 'Chưa có kết quả cuối cùng từ VNPAY.');
    } catch {
      return this.finishRefund(refund.id, 'unknown', null, null, null, 'Chưa lấy được kết quả đối soát; hãy thử lại sau, không gửi một yêu cầu hoàn tiền mới.');
    }
  }

  async reconcilePaymentOrder(orderId: string, adminUserId: string): Promise<PlatformBillingReconciliationDto> {
    const [order] = await db.select().from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1);
    if (!order) throw new NotFoundException('Payment order not found');
    if (['cancelled', 'refunded'].includes(order.status)) throw new ConflictException('Đơn đã hủy/hoàn tiền, không thể đối soát tự động.');
    if (order.status === 'paid') return { orderId, outcome: 'paid', message: 'Đơn đã được ghi nhận thanh toán.', responseCode: '00', transactionStatus: '00', transactionReference: null, completedAt: new Date().toISOString() };
    if (order.status === 'pending' && order.expiresAt > new Date()) throw new ConflictException('Chỉ có thể đối soát đơn đã hết hạn hoặc đang cần xem xét.');
    const settings = await this.platformSettings.getDeliverySettings();
    const vnpayConfig = settings.paymentProviders?.vnpay;
    const momoConfig = settings.paymentProviders?.momo;
    if (order.provider === 'vnpay' && (!vnpayConfig?.tmnCode || !vnpayConfig.hashSecret)) throw new ServiceUnavailableException('VNPAY credentials are not configured');
    if (order.provider === 'momo' && (!momoConfig?.partnerCode || !momoConfig.accessKey || !momoConfig.secretKey)) throw new ServiceUnavailableException('MoMo credentials are not configured');

    const requestId = randomUUID().replaceAll('-', '');
    const requestedAt = new Date();
    const [audit] = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`payment-reconcile:${orderId}`}, 0))`);
      const [locked] = await tx.select().from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1).for('update');
      if (!locked || locked.status === 'paid' || locked.status === 'refunded' || locked.status === 'cancelled') throw new ConflictException('Đơn đã được xử lý trong lúc đối soát.');
      if (locked.status === 'pending' && locked.expiresAt > requestedAt) throw new ConflictException('Chỉ có thể đối soát đơn đã hết hạn hoặc đang cần xem xét.');
      const [recent] = await tx.select({ id: paymentReconciliations.id }).from(paymentReconciliations)
        .where(and(eq(paymentReconciliations.orderId, orderId), gte(paymentReconciliations.requestedAt, new Date(requestedAt.getTime() - 5 * 60_000)))).limit(1);
      if (recent) throw new ConflictException('Đơn vừa được đối soát; vui lòng chờ 5 phút trước khi thử lại.');
      return tx.insert(paymentReconciliations).values({ orderId, initiatedBy: adminUserId, requestId, outcome: 'started' }).returning({ id: paymentReconciliations.id });
    });
    const finish = async (outcome: PlatformBillingReconciliationDto['outcome'], responseCode: string | null, transactionStatus: string | null, transactionNo: string | null, message: string) => {
      const completedAt = new Date();
      await db.update(paymentReconciliations).set({ outcome, responseCode: responseCode?.slice(0, 32) ?? null,
        transactionStatus: transactionStatus?.slice(0, 32) ?? null, transactionNo: transactionNo?.slice(0, 128) ?? null,
        message: message.slice(0, 255), completedAt }).where(eq(paymentReconciliations.id, audit.id));
      return { orderId, outcome, message, responseCode, transactionStatus, transactionReference: maskedReference(transactionNo), completedAt: completedAt.toISOString() } satisfies PlatformBillingReconciliationDto;
    };
    try {
      if (order.provider === 'vnpay') {
        const config = vnpayConfig!;
        if (!config.tmnCode || !config.hashSecret) throw new ServiceUnavailableException('VNPAY credentials are not configured');
        const requestFields = {
          vnp_RequestId: requestId, vnp_Version: '2.1.0', vnp_Command: 'querydr', vnp_TmnCode: config.tmnCode,
          vnp_TxnRef: order.orderReference, vnp_TransactionDate: vnpayDate(order.createdAt),
          vnp_CreateDate: vnpayDate(requestedAt), vnp_IpAddr: process.env.PAYMENTS_SERVER_IP || '127.0.0.1',
          vnp_OrderInfo: `Reconcile ${order.orderReference}`,
        };
        const requestChecksum = [requestFields.vnp_RequestId, requestFields.vnp_Version, requestFields.vnp_Command,
          requestFields.vnp_TmnCode, requestFields.vnp_TxnRef, requestFields.vnp_TransactionDate,
          requestFields.vnp_CreateDate, requestFields.vnp_IpAddr, requestFields.vnp_OrderInfo].join('|');
        const payload = { ...requestFields, vnp_SecureHash: createHmac('sha512', config.hashSecret).update(requestChecksum).digest('hex') };
        const apiUrl = config.mode === 'sandbox' ? 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction' : 'https://pay.vnpay.vn/merchant_webapi/api/transaction';
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) });
        if (!response.ok) return finish('error', null, null, null, 'VNPAY QueryDR không phản hồi thành công.');
        const result = await response.json() as Record<string, unknown>;
        const field = (key: string) => typeof result[key] === 'string' ? result[key] as string : '';
        const responseFields = ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo', 'vnp_PromotionCode', 'vnp_PromotionAmount'].map(field);
        const expectedHash = createHmac('sha512', config.hashSecret).update(responseFields.join('|')).digest('hex');
        if (!signatureMatches(field('vnp_SecureHash'), expectedHash) || field('vnp_TmnCode') !== config.tmnCode || field('vnp_TxnRef') !== order.orderReference) {
          return finish('error', field('vnp_ResponseCode'), field('vnp_TransactionStatus'), null, 'Phản hồi đối soát VNPAY không hợp lệ hoặc sai chữ ký.');
        }
        if (field('vnp_ResponseCode') !== '00' || Number(field('vnp_Amount')) !== order.amountVnd * 100) {
          return finish('error', field('vnp_ResponseCode'), field('vnp_TransactionStatus'), null, 'VNPAY không xác nhận đúng giao dịch hoặc số tiền.');
        }
        const transactionNo = field('vnp_TransactionNo');
        const paid = field('vnp_TransactionStatus') === '00' && field('vnp_TransactionType') === '01' && Boolean(transactionNo);
        if (paid && order.status !== 'paid_review') {
          await this.applyVerifiedPayment('vnpay', order.id, `querydr:${requestId}:${transactionNo}`, result, true, transactionNo, false, parseVnpayDate(field('vnp_PayDate')));
          await this.recordVerifiedVnpayPayment(config, 'QueryDR');
        } else if (!paid) {
          await this.closeUnpaidOrder(order.id);
        }
        const [settled] = await db.select({ status: billingOrders.status }).from(billingOrders).where(eq(billingOrders.id, order.id)).limit(1);
        const outcome = paid && settled?.status === 'paid_review' ? 'paid_review' : paid ? 'paid' : 'not_paid';
        return finish(outcome, field('vnp_ResponseCode'), field('vnp_TransactionStatus'), transactionNo || null,
          outcome === 'paid' ? 'VNPAY xác nhận thanh toán; gói đã được cập nhật.' : outcome === 'paid_review' ? 'VNPAY xác nhận đã thu tiền nhưng đơn cần xử lý thủ công do có trạng thái mới hơn.' : 'VNPAY xác nhận đơn chưa được thanh toán; có thể tạo giao dịch mới.');
      }

      const config = momoConfig!;
      if (!config.partnerCode || !config.accessKey || !config.secretKey) throw new ServiceUnavailableException('MoMo credentials are not configured');
      const apiHost = config.mode === 'sandbox' ? 'https://test-payment.momo.vn' : 'https://payment.momo.vn';
      const request = { partnerCode: config.partnerCode, requestId, orderId: order.orderReference, lang: 'vi' };
      const signature = createHmac('sha256', config.secretKey).update(
        `accessKey=${config.accessKey}&orderId=${request.orderId}&partnerCode=${config.partnerCode}&requestId=${requestId}`,
      ).digest('hex');
      const response = await fetch(`${apiHost}/v2/gateway/api/query`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...request, signature }), signal: AbortSignal.timeout(30_000) });
      if (!response.ok) return finish('error', String(response.status), null, null, 'MoMo Query không phản hồi thành công.');
      const result = await response.json() as Record<string, unknown>;
      const responseCode = String(result.resultCode ?? '');
      const transactionNo = String(result.transId ?? '');
      if (result.partnerCode !== config.partnerCode || result.orderId !== order.orderReference || result.requestId !== requestId) {
        return finish('error', responseCode || null, null, null, 'MoMo Query trả về mã merchant/đơn/yêu cầu không khớp.');
      }
      const paid = Number(result.resultCode) === 0 && Number(result.amount) === order.amountVnd && Boolean(transactionNo) && transactionNo !== '0';
      if (paid && order.status !== 'paid_review') {
        await this.applyVerifiedPayment('momo', order.id, `query:${requestId}:${transactionNo}`, result, true, transactionNo, false);
      } else if (Number(result.resultCode) !== 0) {
        await this.closeUnpaidOrder(order.id);
      }
      const [settled] = await db.select({ status: billingOrders.status }).from(billingOrders).where(eq(billingOrders.id, order.id)).limit(1);
      const outcome = paid && settled?.status === 'paid_review' ? 'paid_review' : paid ? 'paid' : Number(result.resultCode) !== 0 ? 'not_paid' : 'error';
      return finish(outcome, responseCode || null, responseCode || null, transactionNo || null,
        outcome === 'paid' ? 'MoMo xác nhận thanh toán; gói đã được cập nhật.' : outcome === 'paid_review' ? 'MoMo xác nhận đã thu tiền nhưng đơn cần xử lý thủ công do có trạng thái mới hơn.' : outcome === 'not_paid' ? 'MoMo xác nhận đơn chưa được thanh toán; có thể tạo giao dịch mới.' : 'MoMo Query trả về số tiền không khớp đơn hàng.');
    } catch {
      return finish('error', null, null, null, `Không thể kết nối ${order.provider === 'vnpay' ? 'VNPAY QueryDR' : 'MoMo Query'}; có thể thử lại sau 5 phút.`);
    }
  }

  private async closeUnpaidOrder(orderId: string): Promise<void> {
    const now = new Date();
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(billingOrders).where(eq(billingOrders.id, orderId)).for('update').limit(1);
      if (!order || !['pending', 'expired', 'failed'].includes(order.status) || order.status === 'paid_review') return;
      if (order.status === 'pending' && order.expiresAt > now) throw new ConflictException('Không thể đóng một đơn thanh toán còn hiệu lực.');
      if (order.status === 'pending') await tx.update(billingOrders).set({ status: 'expired', updatedAt: now }).where(eq(billingOrders.id, order.id));
      await tx.update(paymentAttempts).set({ status: 'expired', completedAt: now }).where(and(eq(paymentAttempts.orderId, order.id), inArray(paymentAttempts.status, ['initializing', 'pending'])));
    });
  }

  private validatePlan(input: UpsertPlanRequest): UpsertPlanRequest {
    if (!input || typeof input !== 'object') throw new BadRequestException('Cấu hình gói không hợp lệ.');
    const code = typeof input?.code === 'string' ? input.code.trim().toLowerCase() : '';
    const displayName = typeof input?.displayName === 'string' ? input.displayName.trim() : '';
    const features = Array.isArray(input?.features) ? input.features.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean) : [];
    if (!/^[a-z0-9][a-z0-9_-]{0,23}$/.test(code)) throw new BadRequestException('Mã gói chỉ gồm chữ thường, số, dấu gạch ngang hoặc gạch dưới.');
    if (!displayName || displayName.length > 80) throw new BadRequestException('Tên gói bắt buộc và tối đa 80 ký tự.');
    if (!Number.isSafeInteger(input.priceVnd) || input.priceVnd < 0 || input.priceVnd > 2_000_000_000) throw new BadRequestException('Giá gói không hợp lệ.');
    if (!Number.isSafeInteger(input.activeStaffLimit) || input.activeStaffLimit < 1 || input.activeStaffLimit > 100_000) throw new BadRequestException('Giới hạn nhân viên không hợp lệ.');
    if (input.monthlyBookingLimit !== null && (!Number.isSafeInteger(input.monthlyBookingLimit) || input.monthlyBookingLimit < 0 || input.monthlyBookingLimit > 10_000_000)) throw new BadRequestException('Giới hạn lịch đặt không hợp lệ.');
    if (!Number.isSafeInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 10_000) throw new BadRequestException('Thứ tự hiển thị không hợp lệ.');
    if (features.length > 20 || features.some((value) => value.length > 120)) throw new BadRequestException('Tối đa 20 quyền lợi, mỗi quyền lợi tối đa 120 ký tự.');
    return { code, displayName, priceVnd: input.priceVnd, activeStaffLimit: input.activeStaffLimit, monthlyBookingLimit: input.monthlyBookingLimit, sortOrder: input.sortOrder, features };
  }

  async createPlanVersion(input: UpsertPlanRequest): Promise<PlatformPlanDto> {
    const value = this.validatePlan(input);
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'plan-code:' + value.code}, 0))`);
      const rows = await tx.select().from(planCatalog).where(eq(planCatalog.code, value.code)).orderBy(desc(planCatalog.version)).limit(1);
      const version = (rows[0]?.version ?? 0) + 1;
      await tx.update(planCatalog).set({ isActive: false }).where(and(eq(planCatalog.code, value.code), eq(planCatalog.isActive, true)));
      const [plan] = await tx.insert(planCatalog).values({ ...value, currency: 'VND', version, isActive: true }).returning();
      return plan;
    });
    return { ...this.planDto(created), isActive: true, subscriptionCount: 0 };
  }

  async archivePlanVersion(planId: string): Promise<PlatformPlanDto> {
    const [selected] = await db.select().from(planCatalog).where(eq(planCatalog.id, planId)).limit(1);
    if (!selected) throw new NotFoundException('Gói dịch vụ không tồn tại.');
    if (selected.code === 'free') throw new ConflictException({ errorCode: 'FREE_PLAN_REQUIRED', message: 'Không thể ngừng gói miễn phí mặc định của tenant.' });
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'plan-code:' + selected.code}, 0))`);
      const [plan] = await tx.select().from(planCatalog).where(eq(planCatalog.id, planId)).limit(1);
      if (!plan) throw new NotFoundException('Gói dịch vụ không tồn tại.');
      if (!plan.isActive) throw new ConflictException({ errorCode: 'PLAN_ALREADY_ARCHIVED', message: 'Gói này đã ngừng bán.' });
      const [archived] = await tx.update(planCatalog).set({ isActive: false }).where(and(eq(planCatalog.id, planId), eq(planCatalog.isActive, true))).returning();
      const [subscriptions] = await tx.select({ count: sql<number>`count(*) FILTER (WHERE ${tenantSubscriptions.status} = 'active' AND ${tenantSubscriptions.currentPeriodEnd} > now())::int` })
        .from(tenantSubscriptions).where(eq(tenantSubscriptions.planId, planId));
      return { ...this.planDto(archived), isActive: false, subscriptionCount: Number(subscriptions?.count ?? 0) };
    });
  }

  async assignTenantPlan(tenantId: string, actorUserId: string, input: AssignTenantPlanRequest): Promise<void> {
    const note = typeof input?.note === 'string' ? input.note.trim() : '';
    if (!/^[0-9a-f-]{36}$/i.test(input?.planId ?? '') || note.length < 3 || note.length > 1000) throw new BadRequestException('Cần chọn gói hợp lệ và ghi chú từ 3 đến 1.000 ký tự.');
    await this.verifyPlatformPassword(actorUserId, input.currentPassword);
    const [selectedPlan] = await db.select({ code: planCatalog.code }).from(planCatalog).where(eq(planCatalog.id, input.planId)).limit(1);
    if (!selectedPlan) throw new BadRequestException('Gói không tồn tại.');
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'plan-code:' + selectedPlan.code}, 0))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${tenantId}`}, 0))`);
      const [tenant] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      if (!tenant) throw new NotFoundException('Tenant không tồn tại.');
      const [target] = await tx.select().from(planCatalog).where(and(eq(planCatalog.id, input.planId), eq(planCatalog.isActive, true))).limit(1);
      if (!target) throw new BadRequestException('Chỉ có thể gán phiên bản gói đang hoạt động.');
      const [openOrder] = await tx.select({ id: billingOrders.id }).from(billingOrders).where(and(
        eq(billingOrders.tenantId, tenantId), or(
          eq(billingOrders.status, 'pending'), eq(billingOrders.status, 'paid_review'),
          and(eq(billingOrders.status, 'expired'), sql`NOT EXISTS (
            SELECT 1 FROM payment_reconciliations latest
            WHERE latest.order_id = ${billingOrders.id}
              AND latest.requested_at = (SELECT max(pr.requested_at) FROM payment_reconciliations pr WHERE pr.order_id = ${billingOrders.id})
              AND latest.outcome = 'not_paid'
          )`),
        ),
      )).limit(1);
      if (openOrder) throw new ConflictException('Hãy hoàn tất đối soát giao dịch đang mở trước khi cấp gói hỗ trợ.');
      const [openRefund] = await tx.select({ id: paymentRefundRequests.id }).from(paymentRefundRequests).innerJoin(billingOrders, eq(paymentRefundRequests.orderId, billingOrders.id)).where(and(
        eq(billingOrders.tenantId, tenantId), inArray(paymentRefundRequests.status, ['started', 'pending', 'unknown']),
      )).limit(1);
      if (openRefund) throw new ConflictException('Hãy đối soát yêu cầu hoàn tiền đang mở trước khi gán gói hỗ trợ.');
      const [current] = await tx.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantId)).for('update').limit(1);
      const now = new Date();
      const start = now;
      const end = addMonth(start);
      if (current) await tx.update(tenantSubscriptions).set({ planId: target.id, status: 'active', currentPeriodStart: start, currentPeriodEnd: end, updatedAt: now }).where(eq(tenantSubscriptions.tenantId, tenantId));
      else await tx.insert(tenantSubscriptions).values({ tenantId, planId: target.id, status: 'active', currentPeriodStart: start, currentPeriodEnd: end });
      await tx.insert(tenantPlanChanges).values({ tenantId, actorUserId, fromPlanId: current?.planId ?? null, toPlanId: target.id, note, changeType: 'support_grant' });
    });
  }

  async applyLatePayment(orderId: string, actorUserId: string, input: ApplyLatePaymentRequest): Promise<void> {
    const note = typeof input?.note === 'string' ? input.note.trim() : '';
    if (note.length < 3 || note.length > 1000) throw new BadRequestException('Ghi chú xử lý phải có từ 3 đến 1.000 ký tự.');
    await this.verifyPlatformPassword(actorUserId, input.currentPassword);
    const [snapshot] = await db.select({ tenantId: billingOrders.tenantId }).from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1);
    if (!snapshot) throw new NotFoundException('Payment order not found');
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${snapshot.tenantId}`}, 0))`);
      const [order] = await tx.select().from(billingOrders).where(eq(billingOrders.id, orderId)).for('update').limit(1);
      if (!order || order.status !== 'paid_review') throw new ConflictException('Đơn không ở trạng thái đã thanh toán cần đối soát.');
      const [refundRequest] = await tx.select({ id: paymentRefundRequests.id }).from(paymentRefundRequests).where(and(
        eq(paymentRefundRequests.orderId, order.id), inArray(paymentRefundRequests.status, ['started', 'pending', 'unknown', 'succeeded']),
      )).limit(1);
      if (refundRequest) throw new ConflictException('Đơn có yêu cầu hoàn tiền hoặc đã hoàn tiền; không thể áp dụng gói.');
      const [newerPaidOrder] = await tx.select({ id: billingOrders.id }).from(billingOrders).where(and(
        eq(billingOrders.tenantId, order.tenantId), inArray(billingOrders.status, ['paid', 'paid_review']),
        gt(billingOrders.createdAt, order.createdAt), ne(billingOrders.id, order.id),
      )).limit(1);
      const [newerPlanChange] = await tx.select({ id: tenantPlanChanges.id }).from(tenantPlanChanges).where(and(
        eq(tenantPlanChanges.tenantId, order.tenantId), gt(tenantPlanChanges.changedAt, order.createdAt),
      )).limit(1);
      if (newerPaidOrder || newerPlanChange) throw new ConflictException('Đơn cũ đã bị một giao dịch hoặc thay đổi gói mới hơn vượt qua. Hãy hoàn tiền đơn này thay vì ghi đè gói hiện tại.');
      const [target] = await tx.select().from(planCatalog).where(eq(planCatalog.id, order.targetPlanId)).limit(1);
      const [subscription] = await tx.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, order.tenantId)).for('update').limit(1);
      if (!target || !subscription) throw new ServiceUnavailableException('Không tìm thấy gói hoặc subscription của tenant.');
      const [currentPlan] = await tx.select().from(planCatalog).where(eq(planCatalog.id, subscription.planId)).limit(1);
      const now = new Date();
      if (currentPlan && currentPlan.code !== 'free' && currentPlan.id !== target.id && subscription.currentPeriodEnd > now) {
        throw new ConflictException('Tenant đang dùng một gói trả phí khác. Hãy hoàn tiền đơn cũ để tránh ghi đè quyền lợi đang có.');
      }
      const samePlan = subscription.planId === target.id && subscription.currentPeriodEnd > now;
      // A Free-to-paid transition starts a fresh quota period only after this verified payment is applied.
      const periodStart = samePlan ? subscription.currentPeriodStart : now;
      const periodEnd = addMonth(samePlan ? subscription.currentPeriodEnd : periodStart);
      await tx.update(tenantSubscriptions).set({ planId: target.id, status: 'active', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, updatedAt: now }).where(eq(tenantSubscriptions.tenantId, order.tenantId));
      await tx.update(billingOrders).set({ status: 'paid', paidAt: order.paidAt ?? now, updatedAt: now }).where(eq(billingOrders.id, order.id));
      await tx.insert(tenantPlanChanges).values({ tenantId: order.tenantId, actorUserId, fromPlanId: subscription.planId, toPlanId: target.id, note, changeType: 'paid_review_applied' });
    });
  }

  async current(tenantId: string): Promise<TenantBillingDto> {
    const [row] = await db.transaction(async (tx) => {
      const now = new Date();
      await this.ensureCurrentSubscription(tx, tenantId, now);
      return tx.select({ subscription: tenantSubscriptions, plan: planCatalog })
        .from(tenantSubscriptions).innerJoin(planCatalog, eq(tenantSubscriptions.planId, planCatalog.id))
        .where(eq(tenantSubscriptions.tenantId, tenantId)).limit(1);
    });
    if (!row) throw new ServiceUnavailableException({ errorCode: 'SUBSCRIPTION_NOT_INITIALIZED', message: 'Tenant subscription has not been initialized; apply migration 0008 and refresh the API build.' });
    const activeStaff = await db.select({ count: sql<number>`count(*)::int` }).from(staffProfiles)
      .where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.active, true)));
    const [usage] = await db.select().from(tenantBookingUsage).where(and(
      eq(tenantBookingUsage.tenantId, tenantId), eq(tenantBookingUsage.periodStart, row.subscription.currentPeriodStart),
    )).limit(1);
    const providerStatus = await this.platformSettings.safeSettings();
    const providersReady = Boolean(providerStatus.publicAppUrl && providerStatus.paymentCallbackUrls);
    return {
      plan: this.planDto(row.plan), status: row.subscription.status as TenantBillingDto['status'],
      periodStart: row.subscription.currentPeriodStart.toISOString(), periodEnd: row.subscription.currentPeriodEnd.toISOString(),
      usage: { activeStaff: Number(activeStaff[0]?.count ?? 0), bookings: usage?.bookingCount ?? 0, bookingLimit: row.plan.monthlyBookingLimit },
      providers: {
        vnpay: providersReady && providerStatus.paymentProviders.vnpay.enabled && providerStatus.paymentProviders.vnpay.configured,
        momo: providersReady && providerStatus.paymentProviders.momo.enabled && providerStatus.paymentProviders.momo.configured,
      },
    };
  }

  private async ensureCurrentSubscription(tx: any, tenantId: string, now: Date): Promise<{ subscription: typeof tenantSubscriptions.$inferSelect; plan: typeof planCatalog.$inferSelect }> {
    let [row] = await tx.select({ subscription: tenantSubscriptions, plan: planCatalog })
      .from(tenantSubscriptions).innerJoin(planCatalog, eq(tenantSubscriptions.planId, planCatalog.id))
      .where(eq(tenantSubscriptions.tenantId, tenantId)).limit(1).for('update');
    if (!row) {
      const [free] = await tx.select().from(planCatalog).where(and(eq(planCatalog.code, 'free'), eq(planCatalog.isActive, true))).orderBy(desc(planCatalog.version)).limit(1);
      if (!free) throw new ServiceUnavailableException('Free plan is not seeded; apply migration 0008');
      const [subscription] = await tx.insert(tenantSubscriptions).values({ tenantId, planId: free.id, status: 'active', currentPeriodStart: now, currentPeriodEnd: addMonth(now) }).returning();
      row = { subscription, plan: free };
    }
    if (row.subscription.currentPeriodEnd <= now || row.subscription.status === 'expired') {
      const [free] = await tx.select().from(planCatalog).where(and(eq(planCatalog.code, 'free'), eq(planCatalog.isActive, true))).orderBy(desc(planCatalog.version)).limit(1);
      if (!free) throw new ServiceUnavailableException('Free plan is not seeded; apply migration 0008');
      const [subscription] = await tx.update(tenantSubscriptions).set({ planId: free.id, status: 'active', currentPeriodStart: now,
        currentPeriodEnd: addMonth(now), updatedAt: now }).where(eq(tenantSubscriptions.tenantId, tenantId)).returning();
      row = { subscription, plan: free };
    }
    return row;
  }

  async reserveBookingQuota(tx: any, tenantId: string, now: Date): Promise<void> {
    const { subscription, plan } = await this.ensureCurrentSubscription(tx, tenantId, now);
    const cap = plan.monthlyBookingLimit;
    const values = { tenantId, periodStart: subscription.currentPeriodStart, periodEnd: subscription.currentPeriodEnd, bookingCount: 1, updatedAt: now };
    const accepted = await tx.insert(tenantBookingUsage).values(values).onConflictDoUpdate({
      target: [tenantBookingUsage.tenantId, tenantBookingUsage.periodStart],
      set: { bookingCount: sql`${tenantBookingUsage.bookingCount} + 1`, periodEnd: subscription.currentPeriodEnd, updatedAt: now },
      setWhere: cap === null ? undefined : sql`${tenantBookingUsage.bookingCount} < ${cap}`,
    }).returning({ bookingCount: tenantBookingUsage.bookingCount });
    if (!accepted.length) throw new ConflictException({ errorCode: 'PLAN_BOOKING_LIMIT_REACHED', message: 'This tenant has reached the monthly booking limit for its plan', limit: cap });
  }

  async assertStaffCapacity(tx: any, tenantId: string): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`plan-staff:${tenantId}`}, 0))`);
    const now = new Date();
    const { plan } = await this.ensureCurrentSubscription(tx, tenantId, now);
    const [count] = await tx.select({ count: sql<number>`count(*)::int` }).from(staffProfiles)
      .where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.active, true)));
    if (Number(count?.count ?? 0) >= plan.activeStaffLimit) {
      throw new ConflictException({ errorCode: 'PLAN_STAFF_LIMIT_REACHED', message: 'This tenant has reached the active staff profile limit for its plan', limit: plan.activeStaffLimit });
    }
  }

  private async providerSettings(provider: BillingProvider): Promise<{ settings: BillingSettings; config: VnpaySettings | MomoSettings }> {
    const settings = await this.platformSettings.getDeliverySettings();
    const config = provider === 'vnpay' ? settings.paymentProviders?.vnpay : settings.paymentProviders?.momo;
    const ready = provider === 'vnpay'
      ? Boolean((config as VnpaySettings | undefined)?.tmnCode && (config as VnpaySettings | undefined)?.hashSecret)
      : Boolean((config as MomoSettings | undefined)?.partnerCode && (config as MomoSettings | undefined)?.accessKey && (config as MomoSettings | undefined)?.secretKey);
    if (!config?.enabled || !ready || !settings.publicAppUrl || !process.env.PAYMENTS_API_PUBLIC_URL) {
      throw new ServiceUnavailableException({ errorCode: 'PAYMENT_PROVIDER_UNAVAILABLE', message: 'Payment provider is disabled or payment callback URLs are not configured' });
    }
    return { settings, config };
  }

  async checkout(tenantId: string, dto: BillingCheckoutRequest, clientIp: string): Promise<{ orderId: string; status: 'pending'; checkoutUrl: string }> {
    if (!dto || !['vnpay', 'momo'].includes(dto.provider) || typeof dto.planId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.planId)) throw new BadRequestException('A valid plan and payment provider are required');
    const { settings, config } = await this.providerSettings(dto.provider);
    const [requestedPlan] = await db.select().from(planCatalog).where(and(eq(planCatalog.id, dto.planId), eq(planCatalog.isActive, true))).limit(1);
    if (!requestedPlan || requestedPlan.code === 'free' || requestedPlan.priceVnd < 1000) throw new BadRequestException('Select an available paid plan');
    const newOrderId = randomUUID();
    const newOrderReference = newOrderId.replaceAll('-', '');
    const newRequestId = randomUUID().replaceAll('-', '');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60_000);
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'plan-code:' + requestedPlan.code}, 0))`);
      const [currentPlanVersion] = await tx.select().from(planCatalog).where(and(eq(planCatalog.id, dto.planId), eq(planCatalog.isActive, true))).limit(1);
      if (!currentPlanVersion) throw new ConflictException({ errorCode: 'PLAN_NO_LONGER_AVAILABLE', message: 'Gói này vừa ngừng bán. Hãy tải lại danh sách gói.' });
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${tenantId}`}, 0))`);
      const { plan: currentPlan } = await this.ensureCurrentSubscription(tx, tenantId, now);
      const [currentSubscription] = await tx.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantId)).limit(1);
      const [openRefund] = await tx.select({ id: paymentRefundRequests.id }).from(paymentRefundRequests).innerJoin(billingOrders, eq(paymentRefundRequests.orderId, billingOrders.id)).where(and(
        eq(billingOrders.tenantId, tenantId), inArray(paymentRefundRequests.status, ['started', 'pending', 'unknown']),
      )).limit(1);
      if (openRefund) throw new ConflictException({ errorCode: 'REFUND_RECONCILIATION_REQUIRED', message: 'Đang có yêu cầu hoàn tiền cần được đối soát trước khi tạo giao dịch mới.' });
      const [pending] = await tx.select({ id: billingOrders.id, targetPlanId: billingOrders.targetPlanId, provider: billingOrders.provider,
        orderReference: billingOrders.orderReference, amountVnd: billingOrders.amountVnd, expiresAt: billingOrders.expiresAt }).from(billingOrders)
        .where(and(eq(billingOrders.tenantId, tenantId), eq(billingOrders.status, 'pending'), sql`${billingOrders.expiresAt} > now()`)).limit(1);
      if (pending) {
        if (pending.targetPlanId !== dto.planId || pending.provider !== dto.provider) {
          throw new ConflictException({ errorCode: 'PENDING_PAYMENT_EXISTS', message: 'Tiệm đang có giao dịch chờ thanh toán. Hãy tiếp tục giao dịch đó hoặc chờ giao dịch hết hạn trước khi chọn gói/cổng khác.' });
        }
        const [attempt] = await tx.select({ checkoutUrl: paymentAttempts.checkoutUrl, status: paymentAttempts.status,
          providerRequestId: paymentAttempts.providerRequestId, providerOrderReference: paymentAttempts.providerOrderReference })
          .from(paymentAttempts).where(eq(paymentAttempts.orderId, pending.id)).limit(1);
        if (attempt?.status === 'pending' && attempt.checkoutUrl) {
          return { resume: { orderId: pending.id, checkoutUrl: attempt.checkoutUrl } };
        }
        if (dto.provider === 'momo' && attempt?.status === 'initializing') {
          return { retry: { orderId: pending.id, orderReference: attempt.providerOrderReference || pending.orderReference,
            requestId: attempt.providerRequestId, amountVnd: pending.amountVnd, expiresAt: pending.expiresAt } };
        }
        throw new ConflictException({ errorCode: 'PAYMENT_INITIALIZING', message: 'Giao dịch đang được khởi tạo. Vui lòng tải lại sau ít giây.' });
      }
      if (currentPlan.code !== 'free' && currentSubscription?.currentPeriodEnd > now) {
        throw new ConflictException({ errorCode: 'PLAN_PERIOD_ACTIVE', message: `Gói hiện tại còn hiệu lực đến ${currentSubscription.currentPeriodEnd.toISOString()}. Bạn có thể gia hạn hoặc chọn gói khác sau khi kỳ này kết thúc.` });
      }
      const staleOrders = await tx.select({ id: billingOrders.id }).from(billingOrders).where(and(
        eq(billingOrders.tenantId, tenantId), eq(billingOrders.status, 'pending'), lte(billingOrders.expiresAt, now),
      ));
      if (staleOrders.length) {
        const staleOrderIds = staleOrders.map((row: { id: string }) => row.id);
        await tx.update(billingOrders).set({ status: 'expired', updatedAt: now }).where(and(inArray(billingOrders.id, staleOrderIds), eq(billingOrders.status, 'pending')));
        await tx.update(paymentAttempts).set({ status: 'expired', completedAt: now }).where(and(
          inArray(paymentAttempts.orderId, staleOrderIds), inArray(paymentAttempts.status, ['initializing', 'pending']),
        ));
      }
      const [unresolved] = await tx.select({ id: billingOrders.id }).from(billingOrders).where(and(
        eq(billingOrders.tenantId, tenantId),
        or(eq(billingOrders.status, 'paid_review'), and(eq(billingOrders.status, 'expired'), sql`NOT EXISTS (
          SELECT 1 FROM payment_reconciliations latest
          WHERE latest.order_id = ${billingOrders.id}
            AND latest.requested_at = (SELECT max(pr.requested_at) FROM payment_reconciliations pr WHERE pr.order_id = ${billingOrders.id})
            AND latest.outcome = 'not_paid'
        )`)),
      )).limit(1);
      if (unresolved) throw new ConflictException({ errorCode: 'PAYMENT_RECONCILIATION_REQUIRED', message: 'Đơn thanh toán cũ chưa được cổng xác nhận là chưa trả. Quản trị viên nền tảng cần đối soát trước khi tạo đơn mới.' });
      await tx.insert(billingOrders).values({ id: newOrderId, tenantId, targetPlanId: currentPlanVersion.id, provider: dto.provider, orderReference: newOrderReference,
        amountVnd: currentPlanVersion.priceVnd, currency: 'VND', status: 'pending', expiresAt });
      await tx.insert(paymentAttempts).values({ orderId: newOrderId, provider: dto.provider, providerRequestId: newRequestId,
         providerOrderReference: newOrderReference, status: 'initializing' });
      return { plan: currentPlanVersion };
    });

    if ('resume' in plan && plan.resume) return { orderId: plan.resume.orderId, status: 'pending', checkoutUrl: plan.resume.checkoutUrl };

    const payment = 'retry' in plan && plan.retry ? plan.retry : 'plan' in plan && plan.plan ? {
      orderId: newOrderId, orderReference: newOrderReference, requestId: newRequestId,
      amountVnd: plan.plan.priceVnd, expiresAt,
    } : null;
    if (!payment) throw new ServiceUnavailableException('Payment order initialization returned no order details');

    let checkoutUrl: string;
    checkoutUrl = dto.provider === 'vnpay'
      ? this.buildVnpayUrl(payment.orderReference, payment.orderId, payment.amountVnd, payment.expiresAt, config as VnpaySettings, settings.publicAppUrl!, clientIp)
      : await this.createMomoUrl(payment.orderReference, payment.orderId, payment.requestId, payment.amountVnd, payment.expiresAt, config as MomoSettings, settings.publicAppUrl!, process.env.PAYMENTS_API_PUBLIC_URL!);
    await db.update(paymentAttempts).set({ checkoutUrl, status: 'pending' }).where(and(eq(paymentAttempts.orderId, payment.orderId), eq(paymentAttempts.status, 'initializing')));
    return { orderId: payment.orderId, status: 'pending', checkoutUrl };
  }

  private buildVnpayUrl(ref: string, orderId: string, amount: number, expiresAt: Date, config: VnpaySettings, appUrl: string, clientIp: string): string {
    if (!config.tmnCode || !config.hashSecret) throw new ServiceUnavailableException('VNPAY credentials are incomplete');
    const now = new Date();
    const date = (value: Date) => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(value).map((part) => [part.type, part.value]));
      return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
    };
    const mappedIpv4 = clientIp.startsWith('::ffff:') ? clientIp.slice(7) : '';
    const vnpayIp = isIP(clientIp) === 4 ? clientIp : isIP(mappedIpv4) === 4 ? mappedIpv4 : '127.0.0.1';
    const params: Record<string, string> = {
      vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: config.tmnCode, vnp_Amount: String(amount * 100),
      vnp_CurrCode: 'VND', vnp_TxnRef: ref, vnp_OrderInfo: `ZenBook plan ${ref}`, vnp_OrderType: 'other',
      vnp_Locale: 'vn', vnp_ReturnUrl: `${appUrl}/workspace/billing?payment=return&orderId=${encodeURIComponent(orderId)}`, vnp_IpAddr: vnpayIp,
      vnp_CreateDate: date(now), vnp_ExpireDate: date(expiresAt),
    };
    const signature = createHmac('sha512', config.hashSecret).update(vnpayCanonical(params), 'utf8').digest('hex');
    const query = `${vnpayCanonical(params)}&vnp_SecureHash=${signature}`;
    const host = config.mode === 'sandbox' ? 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html' : 'https://pay.vnpay.vn/vpcpay.html';
    return `${host}?${query}`;
  }

  private async createMomoUrl(orderRef: string, orderId: string, requestId: string, amount: number, expiresAt: Date, config: MomoSettings, appUrl: string, apiUrl: string): Promise<string> {
    if (!config.partnerCode || !config.accessKey || !config.secretKey) throw new ServiceUnavailableException('MoMo credentials are incomplete');
    if (amount < 1000 || amount > 50_000_000) throw new BadRequestException('MoMo supports order amounts from 1,000 to 50,000,000 VND');
    const payload: Record<string, string | number> = {
      partnerCode: config.partnerCode, requestId, amount, orderId: orderRef,
      orderInfo: 'ZenBook plan subscription', redirectUrl: `${appUrl}/workspace/billing?payment=return&orderId=${encodeURIComponent(orderId)}`,
      ipnUrl: `${apiUrl}/v1/billing/webhooks/momo`, requestType: 'payWithMethod', extraData: '', lang: 'vi',
      orderExpireTime: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 60_000)),
    };
    const canonical = `accessKey=${config.accessKey}&amount=${amount}&extraData=&ipnUrl=${payload.ipnUrl}&orderId=${orderRef}&orderInfo=${payload.orderInfo}&partnerCode=${config.partnerCode}&redirectUrl=${payload.redirectUrl}&requestId=${requestId}&requestType=payWithMethod`;
    payload.signature = createHmac('sha256', config.secretKey).update(canonical).digest('hex');
    const base = config.mode === 'sandbox' ? 'https://test-payment.momo.vn' : 'https://payment.momo.vn';
    let response: Response;
    try {
      response = await fetch(`${base}/v2/gateway/api/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new ServiceUnavailableException({ errorCode: 'MOMO_GATEWAY_UNREACHABLE',
        message: timedOut ? 'MoMo không phản hồi trong 30 giây. Có thể thử khởi tạo lại giao dịch.' : 'Không thể kết nối tới cổng thanh toán MoMo.' });
    }
    const responseText = await response.text();
    let result: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(responseText);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) result = parsed as Record<string, unknown>;
    } catch { /* provider may return a non-JSON error page */ }
    if (!response.ok) {
      const code = typeof result.resultCode === 'number' || typeof result.resultCode === 'string' ? `, mã MoMo ${String(result.resultCode).slice(0, 24)}` : '';
      const providerMessage = typeof result.message === 'string'
        ? result.message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180)
        : '';
      const reason = providerMessage ? `: ${providerMessage}` : '';
      throw new ServiceUnavailableException({ errorCode: 'MOMO_CHECKOUT_REJECTED',
        message: `MoMo từ chối khởi tạo thanh toán (HTTP ${response.status}${code})${reason}` });
    }
    const responseCanonical = momoCanonical(result, ['accessKey', 'amount', 'message', 'orderId', 'partnerCode', 'payUrl', 'requestId', 'responseTime', 'resultCode']).replace('accessKey=', `accessKey=${config.accessKey}`);
    const expectedResponseSignature = createHmac('sha256', config.secretKey).update(responseCanonical).digest('hex');
    if (!signatureMatches(String(result.signature ?? ''), expectedResponseSignature)) {
      throw new ServiceUnavailableException('MoMo did not return an authenticated payment link');
    }
    if (result.resultCode !== 0) {
      const code = typeof result.resultCode === 'number' || typeof result.resultCode === 'string' ? String(result.resultCode).slice(0, 24) : 'không rõ';
      const providerMessage = typeof result.message === 'string'
        ? result.message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180)
        : '';
      throw new ServiceUnavailableException({ errorCode: 'MOMO_CHECKOUT_REJECTED',
        message: `MoMo không chấp nhận yêu cầu (mã ${code})${providerMessage ? `: ${providerMessage}` : ''}` });
    }
    let payUrl: URL | null = null;
    try { if (typeof result.payUrl === 'string') payUrl = new URL(result.payUrl); } catch { /* invalid provider link */ }
    if (result.partnerCode !== config.partnerCode || result.requestId !== requestId || result.orderId !== orderRef
      || Number(result.amount) !== amount || !payUrl || payUrl.origin !== base) {
      throw new ServiceUnavailableException('MoMo did not return an authenticated payment link');
    }
    return payUrl.toString();
  }

  async order(tenantId: string, orderId: string): Promise<BillingOrderDto> {
    const [row] = await db.select({ order: billingOrders, plan: planCatalog }).from(billingOrders)
      .innerJoin(planCatalog, eq(billingOrders.targetPlanId, planCatalog.id))
      .where(and(eq(billingOrders.tenantId, tenantId), eq(billingOrders.id, orderId))).limit(1);
    if (!row) throw new NotFoundException('Billing order not found');
    return { id: row.order.id, plan: this.planDto(row.plan), provider: row.order.provider as BillingProvider,
      amountVnd: row.order.amountVnd, status: row.order.status as BillingOrderDto['status'],
      expiresAt: row.order.expiresAt.toISOString(), createdAt: row.order.createdAt.toISOString() };
  }

  async listOrders(tenantId: string): Promise<BillingOrderDto[]> {
    const now = new Date();
    const expired = await db.select({ id: billingOrders.id }).from(billingOrders).where(and(
      eq(billingOrders.tenantId, tenantId), eq(billingOrders.status, 'pending'), lte(billingOrders.expiresAt, now),
    ));
    if (expired.length) {
      await db.transaction(async (tx) => {
        const ids = expired.map((row) => row.id);
        await tx.update(billingOrders).set({ status: 'expired', updatedAt: now }).where(and(eq(billingOrders.tenantId, tenantId), inArray(billingOrders.id, ids), eq(billingOrders.status, 'pending')));
        await tx.update(paymentAttempts).set({ status: 'expired', completedAt: now }).where(and(inArray(paymentAttempts.orderId, ids), inArray(paymentAttempts.status, ['initializing', 'pending'])));
      });
    }
    const orders = await db.select({ order: billingOrders, plan: planCatalog }).from(billingOrders)
      .innerJoin(planCatalog, eq(billingOrders.targetPlanId, planCatalog.id)).where(eq(billingOrders.tenantId, tenantId))
      .orderBy(desc(billingOrders.createdAt)).limit(20);
    return orders.map(({ order, plan }) => ({ id: order.id, plan: this.planDto(plan), provider: order.provider as BillingProvider,
      amountVnd: order.amountVnd, status: order.status as BillingOrderDto['status'], expiresAt: order.expiresAt.toISOString(), createdAt: order.createdAt.toISOString() }));
  }

  async vnpayIpn(query: Record<string, unknown>): Promise<{ RspCode: string; Message: string }> {
    const params = Object.fromEntries(Object.entries(query).filter(([key, value]) => key.startsWith('vnp_') && !['vnp_SecureHash', 'vnp_SecureHashType'].includes(key) && typeof value === 'string')) as Record<string, string>;
    const settings = await this.platformSettings.getDeliverySettings();
    const config = settings.paymentProviders?.vnpay;
    if (!config?.hashSecret || !config.tmnCode || query.vnp_TmnCode !== config.tmnCode || typeof query.vnp_SecureHash !== 'string') return { RspCode: '97', Message: 'Invalid signature' };
    const expected = createHmac('sha512', config.hashSecret).update(vnpayCanonical(params)).digest('hex');
    if (!signatureMatches(query.vnp_SecureHash, expected)) return { RspCode: '97', Message: 'Invalid signature' };
    const ref = String(query.vnp_TxnRef ?? '');
    const [order] = await db.select().from(billingOrders).where(and(eq(billingOrders.orderReference, ref), eq(billingOrders.provider, 'vnpay'))).limit(1);
    if (!order) return { RspCode: '01', Message: 'Order not found' };
    if (Number(query.vnp_Amount) !== order.amountVnd * 100 || (query.vnp_CurrCode !== undefined && query.vnp_CurrCode !== 'VND')) {
      return { RspCode: '04', Message: 'Invalid amount' };
    }
    const resultCode = String(query.vnp_ResponseCode ?? '');
    const transactionId = String(query.vnp_TransactionNo ?? '');
    const verifiedPaid = resultCode === '00' && String(query.vnp_TransactionStatus ?? '') === '00';
    await this.applyVerifiedPayment('vnpay', order.id, `${ref}:${transactionId}:${resultCode}`, params, verifiedPaid, transactionId, true, parseVnpayDate(query.vnp_PayDate));
    if (verifiedPaid && config) await this.recordVerifiedVnpayPayment(config, 'IPN');
    return { RspCode: '00', Message: 'Confirm Success' };
  }

  async momoIpn(body: Record<string, unknown>): Promise<void> {
    const settings = await this.platformSettings.getDeliverySettings();
    const config = settings.paymentProviders?.momo;
    if (!config?.partnerCode || !config.accessKey || !config.secretKey || typeof body.signature !== 'string') throw new BadRequestException('Invalid MoMo notification');
    const fields = ['accessKey', 'amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId'];
    const canonical = momoCanonical(body, fields);
    const expected = createHmac('sha256', config.secretKey).update(canonical.replace('accessKey=', `accessKey=${config.accessKey}`)).digest('hex');
    if (!signatureMatches(body.signature, expected) || body.partnerCode !== config.partnerCode) throw new BadRequestException('Invalid MoMo notification signature');
    const [order] = await db.select().from(billingOrders).where(and(eq(billingOrders.orderReference, String(body.orderId ?? '')), eq(billingOrders.provider, 'momo'))).limit(1);
    if (!order || Number(body.amount) !== order.amountVnd) throw new BadRequestException('MoMo order or amount mismatch');
    const [attempt] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, order.id)).orderBy(desc(paymentAttempts.createdAt)).limit(1);
    if (!attempt || body.requestId !== attempt.providerRequestId || attempt.providerOrderReference !== body.orderId) throw new BadRequestException('MoMo request reference mismatch');
    await this.applyVerifiedPayment('momo', order.id, `${body.orderId}:${body.transId ?? ''}:${body.resultCode}`, body, Number(body.resultCode) === 0, String(body.transId ?? ''));
  }

  private async applyVerifiedPayment(provider: BillingProvider, orderId: string, eventKey: string, payload: unknown, paid: boolean, transactionId: string, recordWebhook = true, providerPaidAt: Date | null = null): Promise<void> {
    const [snapshot] = await db.select({ tenantId: billingOrders.tenantId }).from(billingOrders).where(eq(billingOrders.id, orderId)).limit(1);
    if (!snapshot) throw new NotFoundException('Payment order not found');
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${snapshot.tenantId}`}, 0))`);
      const [order] = await tx.select().from(billingOrders).where(eq(billingOrders.id, orderId)).for('update').limit(1);
      if (!order || order.provider !== provider) throw new NotFoundException('Payment order not found');
      const [attempt] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, order.id)).orderBy(desc(paymentAttempts.createdAt)).limit(1).for('update');
      if (!attempt) throw new NotFoundException('Payment attempt not found');
      if (recordWebhook) {
        const [existing] = await tx.select({ id: paymentWebhookEvents.id }).from(paymentWebhookEvents)
          .where(and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.eventKey, eventKey))).limit(1);
        if (existing) return;
        await tx.insert(paymentWebhookEvents).values({ provider, eventKey: eventKey.slice(0, 255), orderId: order.id, paymentAttemptId: attempt.id,
          signatureVerified: true, payload: payload as Record<string, unknown>, status: 'received' }).onConflictDoNothing();
      }
      if (['paid', 'paid_review', 'refunded'].includes(order.status)) {
        if (recordWebhook) await tx.update(paymentWebhookEvents).set({ status: 'processed', processedAt: new Date() }).where(and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.eventKey, eventKey.slice(0, 255))));
        return;
      }
      const now = new Date();
      if (!paid && order.expiresAt <= now && order.status === 'pending') {
        await tx.update(billingOrders).set({ status: 'expired', updatedAt: now }).where(eq(billingOrders.id, order.id));
        await tx.update(paymentAttempts).set({ status: 'expired', completedAt: now, providerTransactionId: transactionId && transactionId !== '0' ? transactionId : null,
          providerPaidAt }).where(eq(paymentAttempts.id, attempt.id));
        if (recordWebhook) await tx.update(paymentWebhookEvents).set({ status: 'processed', processedAt: now }).where(and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.eventKey, eventKey.slice(0, 255))));
        return;
      }
      if (['cancelled', 'refunded'].includes(order.status)) {
        if (recordWebhook) await tx.update(paymentWebhookEvents).set({ status: 'processed', processedAt: now }).where(and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.eventKey, eventKey.slice(0, 255))));
        return;
      }
      if (paid) {
        const [plan] = await tx.select().from(planCatalog).where(eq(planCatalog.id, order.targetPlanId)).limit(1);
        const [subscription] = await tx.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, order.tenantId)).for('update').limit(1);
        if (!plan || !subscription) throw new ServiceUnavailableException('Plan or tenant subscription is unavailable');
        const [newerOrder] = await tx.select({ id: billingOrders.id }).from(billingOrders).where(and(
          eq(billingOrders.tenantId, order.tenantId), inArray(billingOrders.status, ['pending', 'paid', 'paid_review', 'refunded']),
          ne(billingOrders.id, order.id), gt(billingOrders.createdAt, order.createdAt),
        )).limit(1);
        const [newerPlanChange] = await tx.select({ id: tenantPlanChanges.id }).from(tenantPlanChanges).where(and(
          eq(tenantPlanChanges.tenantId, order.tenantId), gt(tenantPlanChanges.changedAt, order.createdAt),
        )).limit(1);
        const [refundInProgress] = await tx.select({ id: paymentRefundRequests.id }).from(paymentRefundRequests).where(and(
          eq(paymentRefundRequests.orderId, order.id), inArray(paymentRefundRequests.status, ['started', 'pending', 'unknown', 'succeeded']),
        )).limit(1);
        const [currentPlan] = await tx.select().from(planCatalog).where(eq(planCatalog.id, subscription.planId)).limit(1);
        const superseded = order.status !== 'pending' || order.expiresAt <= now || Boolean(newerOrder) || Boolean(newerPlanChange) || Boolean(refundInProgress)
          || Boolean(currentPlan && currentPlan.code !== 'free' && currentPlan.id !== plan.id && subscription.currentPeriodEnd > now);
        if (superseded) {
          await tx.update(billingOrders).set({ status: 'paid_review', paidAt: order.paidAt ?? now, updatedAt: now }).where(eq(billingOrders.id, order.id));
          await tx.update(paymentAttempts).set({ status: 'succeeded', completedAt: now, providerTransactionId: transactionId || null, providerPaidAt }).where(eq(paymentAttempts.id, attempt.id));
          await publishTenantNotification(tx, order.tenantId, 'payment_review', 'Thanh toán cần đối soát', 'Giao dịch đã ghi nhận nhưng cần kiểm tra trước khi cập nhật gói.', '/workspace/billing', {
            kind: 'payment', planName: plan.displayName, provider: order.provider,
          });
          if (recordWebhook) await tx.update(paymentWebhookEvents).set({ status: 'processed', processedAt: now }).where(and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.eventKey, eventKey.slice(0, 255))));
          return;
        }
        const samePlan = subscription.planId === plan.id && subscription.currentPeriodEnd > now;
        // Free-to-paid access and its new quota period begin here, after the provider payment is verified.
        const periodStart = samePlan ? subscription.currentPeriodStart : now;
        const periodEnd = addMonth(samePlan ? subscription.currentPeriodEnd : periodStart);
        await tx.update(tenantSubscriptions).set({ planId: plan.id, status: 'active', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, updatedAt: now }).where(eq(tenantSubscriptions.tenantId, order.tenantId));
        await tx.update(billingOrders).set({ status: 'paid', paidAt: now, updatedAt: now }).where(eq(billingOrders.id, order.id));
        await tx.update(paymentAttempts).set({ status: 'succeeded', completedAt: now, providerTransactionId: transactionId || null, providerPaidAt }).where(eq(paymentAttempts.id, attempt.id));
        await publishTenantNotification(tx, order.tenantId, 'payment_paid', 'Thanh toán thành công', 'Gói dịch vụ của tiệm đã được cập nhật.', '/workspace/billing', {
          kind: 'payment', planName: plan.displayName, provider: order.provider, periodEndsAt: periodEnd.toISOString(),
        });
      } else {
        if (order.status !== 'pending') {
          if (recordWebhook) await tx.update(paymentWebhookEvents).set({ status: 'processed', processedAt: now }).where(and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.eventKey, eventKey.slice(0, 255))));
          return;
        }
        await tx.update(billingOrders).set({ status: 'failed', updatedAt: now }).where(eq(billingOrders.id, order.id));
        await tx.update(paymentAttempts).set({ status: 'failed', completedAt: now, providerTransactionId: transactionId && transactionId !== '0' ? transactionId : null }).where(eq(paymentAttempts.id, attempt.id));
        const [failedPlan] = await tx.select({ displayName: planCatalog.displayName }).from(planCatalog).where(eq(planCatalog.id, order.targetPlanId)).limit(1);
        await publishTenantNotification(tx, order.tenantId, 'payment_failed', 'Thanh toán chưa thành công', 'Bạn có thể kiểm tra và thử thanh toán lại trong workspace.', '/workspace/billing', {
          kind: 'payment', planName: failedPlan?.displayName ?? 'Gói đã chọn', provider: order.provider,
        });
      }
      if (recordWebhook) await tx.update(paymentWebhookEvents).set({ status: 'processed', processedAt: now }).where(and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.eventKey, eventKey.slice(0, 255))));
    });
  }
}
