import { BadRequestException, Body, Controller, Get, Header, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Sse, UseGuards, type MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type {
  PlatformTenantDto,
  PlatformTenantDetailDto,
  PlatformNotificationDto,
  ReviewTenantApplicationRequest,
  TenantApplicationDto,
  UpdateTenantStatusRequest,
  PlatformPlanDto,
  UpsertPlanRequest,
  AssignTenantPlanRequest,
  PlatformBillingFilters,
  PlatformBillingOrderDto,
  PlatformBillingOrderPageDto,
  PlatformBillingSubscriptionPageDto,
  PlatformBillingSummaryDto,
  PlatformBillingReconciliationDto,
  PlatformBillingRefundDto,
  ReconcileRefundDto,
  ReconcileRefundRequest,
  RefundPaymentRequest,
  ApplyLatePaymentRequest,
} from '@sbc/contracts';
import type { User } from '@sbc/database';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PlatformAdminGuard } from '../platform-settings/platform-admin.guard';
import { TenantManagementService } from './tenant-management.service';
import { BillingService } from '../billing/billing.service';
import { PlatformNotificationEventsService } from './platform-notification-events.service';

@Controller('platform')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class PlatformTenantsController {
  constructor(
    @Inject(TenantManagementService) private readonly management: TenantManagementService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(PlatformNotificationEventsService) private readonly notificationEvents: PlatformNotificationEventsService,
  ) {}

  @Get('plans')
  plans(): Promise<PlatformPlanDto[]> { return this.billing.listPlatformPlans(); }

  @Post('plans')
  createPlanVersion(@Body() body: UpsertPlanRequest): Promise<PlatformPlanDto> { return this.billing.createPlanVersion(body); }

  @Patch('plans/:planId/archive')
  archivePlan(@Param('planId', new ParseUUIDPipe()) planId: string): Promise<PlatformPlanDto> { return this.billing.archivePlanVersion(planId); }

  private billingFilters(query: Record<string, unknown>): PlatformBillingFilters {
    const numberParam = (key: string): number | undefined => {
      const value = query[key];
      if (value === undefined || value === '') return undefined;
      if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new BadRequestException(`Invalid ${key}.`);
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) throw new BadRequestException(`Invalid ${key}.`);
      return parsed;
    };
    return {
      search: typeof query.search === 'string' ? query.search : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
      provider: typeof query.provider === 'string' ? query.provider as PlatformBillingFilters['provider'] : undefined,
      planCode: typeof query.planCode === 'string' ? query.planCode : undefined,
      from: typeof query.from === 'string' ? query.from : undefined,
      to: typeof query.to === 'string' ? query.to : undefined,
      page: numberParam('page'), pageSize: numberParam('pageSize'),
    };
  }

  @Get('billing/summary')
  billingSummary(@Query() query: Record<string, unknown>): Promise<PlatformBillingSummaryDto> {
    return this.billing.getPlatformBillingSummary(
      typeof query.from === 'string' ? query.from : undefined,
      typeof query.to === 'string' ? query.to : undefined,
    );
  }

  @Get('billing/subscriptions')
  billingSubscriptions(@Query() query: Record<string, unknown>): Promise<PlatformBillingSubscriptionPageDto> {
    return this.billing.listPlatformBillingSubscriptions(this.billingFilters(query));
  }

  @Get('billing/orders')
  billingOrders(@Query() query: Record<string, unknown>): Promise<PlatformBillingOrderPageDto> {
    return this.billing.listPlatformBillingOrders(this.billingFilters(query));
  }

  @Get('billing/reconciliation-needed')
  billingReconciliationNeeded(@Query() query: Record<string, unknown>): Promise<PlatformBillingOrderDto[]> {
    return this.billing.listPlatformBillingReconciliationOrders(this.billingFilters(query));
  }

  @Post('billing/orders/:orderId/reconcile')
  reconcileBillingOrder(@CurrentUser() user: User, @Param('orderId', new ParseUUIDPipe()) orderId: string): Promise<PlatformBillingReconciliationDto> {
    return this.billing.reconcilePaymentOrder(orderId, user.id);
  }

  @Post('billing/orders/:orderId/refund')
  refundBillingOrder(@CurrentUser() user: User, @Param('orderId', new ParseUUIDPipe()) orderId: string, @Body() body: RefundPaymentRequest): Promise<PlatformBillingRefundDto> {
    return this.billing.requestFullRefund(orderId, user.id, body);
  }

  @Post('billing/orders/:orderId/refunds/:refundId/reconcile')
  reconcileBillingRefund(@CurrentUser() user: User, @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Param('refundId', new ParseUUIDPipe()) refundId: string, @Body() body: ReconcileRefundRequest): Promise<ReconcileRefundDto> {
    return this.billing.reconcileRefund(orderId, refundId, user.id, body?.currentPassword);
  }

  @Post('billing/orders/:orderId/apply-late-payment')
  applyLatePayment(@CurrentUser() user: User, @Param('orderId', new ParseUUIDPipe()) orderId: string, @Body() body: ApplyLatePaymentRequest): Promise<void> {
    return this.billing.applyLatePayment(orderId, user.id, body);
  }

  @Patch('tenants/:tenantId/plan')
  assignTenantPlan(@CurrentUser() user: User, @Param('tenantId', new ParseUUIDPipe()) tenantId: string, @Body() body: AssignTenantPlanRequest): Promise<void> {
    return this.billing.assignTenantPlan(tenantId, user.id, body);
  }

  @Get('tenants')
  tenants(): Promise<PlatformTenantDto[]> {
    return this.management.listTenants();
  }

  @Get('tenants/:tenantId')
  tenantDetail(@Param('tenantId', new ParseUUIDPipe()) tenantId: string): Promise<PlatformTenantDetailDto> {
    return this.management.getTenantDetail(tenantId);
  }

  @Get('notifications')
  notifications(@CurrentUser() user: User): Promise<PlatformNotificationDto[]> {
    return this.management.listNotifications(user.id);
  }

  @Sse('notifications/stream')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('X-Accel-Buffering', 'no')
  notificationStream(): Observable<MessageEvent> {
    return this.notificationEvents.stream();
  }

  @Patch('notifications/:notificationId/read')
  markNotificationRead(
    @CurrentUser() user: User,
    @Param('notificationId', new ParseUUIDPipe()) notificationId: string,
  ): Promise<{ read: true }> {
    return this.management.markNotificationRead(user.id, notificationId);
  }

  @Patch('tenants/:tenantId/status')
  updateTenantStatus(@Param('tenantId', new ParseUUIDPipe()) tenantId: string, @Body() body: UpdateTenantStatusRequest): Promise<PlatformTenantDto> {
    return this.management.updateTenantStatus(tenantId, body);
  }

  @Get('tenant-applications')
  applications(): Promise<TenantApplicationDto[]> {
    return this.management.listApplications();
  }

  @Patch('tenant-applications/:applicationId/review')
  reviewApplication(
    @CurrentUser() user: User,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
    @Body() body: ReviewTenantApplicationRequest,
  ): Promise<TenantApplicationDto> {
    return this.management.reviewApplication(applicationId, user.id, body);
  }
}
