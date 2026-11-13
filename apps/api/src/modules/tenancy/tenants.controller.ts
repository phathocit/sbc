import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  CreateTenantRequest,
  LocationDto,
  MembershipRole,
  MembershipStatus,
  TenantContextDto,
  TenantDto,
  TenantPolicyDto,
  UpdateTenantRequest,
  UpdateTenantThemeRequest,
  TenantThemeMode,
} from '@sbc/contracts';
import type { User } from '@sbc/database';
import { CurrentTenant, RequestTenantContext } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PlatformAdminGuard } from '../platform-settings/platform-admin.guard';
import { TenancyService } from './tenancy.service';

@Controller('tenants')
@UseGuards(AuthGuard)
export class TenantsController {
  constructor(@Inject(TenancyService) private readonly tenancyService: TenancyService) {}

  @Post()
  @UseGuards(PlatformAdminGuard)
  async createTenant(
    @CurrentUser() user: User,
    @Body() dto: CreateTenantRequest,
  ): Promise<{
    tenant: TenantDto;
    location: LocationDto;
    policy: TenantPolicyDto;
  }> {
    return this.tenancyService.createTenant(user.id, dto);
  }

  @Get()
  async listUserTenants(
    @CurrentUser() user: User,
  ): Promise<
    Array<{
      tenant: TenantDto;
      role: MembershipRole;
      status: MembershipStatus;
    }>
  > {
    return this.tenancyService.listUserTenants(user.id);
  }

  @Get('current')
  @UseGuards(TenantGuard)
  async getCurrentTenant(
    @CurrentUser() user: User,
    @CurrentTenant() context: RequestTenantContext,
  ): Promise<TenantContextDto> {
    return this.tenancyService.getCurrentTenantContext(context.tenant.id, user.id);
  }

  @Patch('current/theme')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles('owner')
  async updateCurrentTenantTheme(
    @CurrentTenant() context: RequestTenantContext,
    @Body() dto: UpdateTenantThemeRequest,
  ): Promise<{ themeKey: string | null; themeMode: TenantThemeMode }> {
    return this.tenancyService.updateTenantTheme(context.tenant.id, dto);
  }

  @Patch('current')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles('owner', 'admin')
  async updateCurrentTenant(
    @CurrentTenant() context: RequestTenantContext,
    @Body() dto: UpdateTenantRequest,
  ): Promise<TenantDto> {
    return this.tenancyService.updateTenant(context.tenant.id, dto);
  }
}
