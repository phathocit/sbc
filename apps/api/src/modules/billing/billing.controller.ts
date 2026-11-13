import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { BillingCheckoutRequest, BillingCheckoutResponse, BillingOrderDto, PlanDto, TenantBillingDto } from '@sbc/contracts';
import type { Request } from 'express';
import { CurrentTenant, RequestTenantContext } from '../../common/decorators/current-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get('catalog')
  catalog(): Promise<PlanDto[]> { return this.billing.listPlans(); }

  @UseGuards(AuthGuard, TenantGuard)
  @Get('plans')
  plans(): Promise<PlanDto[]> { return this.billing.listPlans(); }

  @UseGuards(AuthGuard, TenantGuard)
  @Get('current')
  current(@CurrentTenant() context: RequestTenantContext): Promise<TenantBillingDto> {
    return this.billing.current(context.tenant.id);
  }

  @UseGuards(AuthGuard, TenantGuard, RolesGuard)
  @Roles('owner')
  @Post('checkout')
  checkout(@CurrentTenant() context: RequestTenantContext, @Req() request: Request, @Body() body: BillingCheckoutRequest): Promise<BillingCheckoutResponse> {
    return this.billing.checkout(context.tenant.id, body, request.ip ?? request.socket.remoteAddress ?? '');
  }

  @Get('orders')
  @UseGuards(AuthGuard, TenantGuard, RolesGuard)
  @Roles('owner', 'admin')
  orders(@CurrentTenant() context: RequestTenantContext): Promise<BillingOrderDto[]> {
    return this.billing.listOrders(context.tenant.id);
  }

  @Get('orders/:orderId')
  @UseGuards(AuthGuard, TenantGuard, RolesGuard)
  @Roles('owner', 'admin')
  order(@CurrentTenant() context: RequestTenantContext, @Param('orderId') id: string): Promise<BillingOrderDto> {
    return this.billing.order(context.tenant.id, id);
  }

  @Get('webhooks/vnpay')
  vnpay(@Query() query: Record<string, unknown>) { return this.billing.vnpayIpn(query); }

  @Post('webhooks/momo')
  @HttpCode(204)
  async momo(@Body() body: Record<string, unknown>): Promise<void> { await this.billing.momoIpn(body); }
}
