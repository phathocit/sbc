import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { TenantPolicyDto, UpdateTenantPolicyRequest } from '@sbc/contracts';
import { CurrentTenant, RequestTenantContext } from '../../common/decorators/current-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenancyService } from './tenancy.service';

@Controller('tenant-policies')
@UseGuards(AuthGuard, TenantGuard)
export class TenantPoliciesController {
  constructor(@Inject(TenancyService) private readonly tenancyService: TenancyService) {}

  @Get()
  async getPolicies(
    @CurrentTenant() context: RequestTenantContext,
  ): Promise<TenantPolicyDto> {
    return this.tenancyService.getTenantPolicies(context.tenant.id);
  }

  @Put()
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  async updatePolicies(
    @CurrentTenant() context: RequestTenantContext,
    @Body() dto: UpdateTenantPolicyRequest,
  ): Promise<TenantPolicyDto> {
    if (dto.appointmentReminderMinutes !== undefined && context.membership.role !== 'owner') {
      throw new ForbiddenException('Only the tenant owner can change appointment reminders');
    }
    return this.tenancyService.updateTenantPolicies(context.tenant.id, dto);
  }
}
