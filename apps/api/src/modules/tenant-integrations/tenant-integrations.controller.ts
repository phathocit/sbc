import { Body, Controller, Get, Inject, Patch, Post, Put, UseGuards } from '@nestjs/common';
import type {
  ConfirmTelegramGroupRequest, SaveTenantTelegramIntegrationRequest, TenantTelegramIntegrationDto,
  TelegramGroupDiscoveryDto, TelegramIntegrationTestDto, TelegramPairingCodeDto,
} from '@sbc/contracts';
import type { User } from '@sbc/database';
import { CurrentTenant, type RequestTenantContext } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantIntegrationsService } from './tenant-integrations.service';

@Controller('integrations/telegram')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('owner')
export class TenantIntegrationsController {
  constructor(@Inject(TenantIntegrationsService) private readonly integrations: TenantIntegrationsService) {}

  @Get()
  get(@CurrentTenant() context: RequestTenantContext): Promise<TenantTelegramIntegrationDto> {
    return this.integrations.get(context.tenant.id);
  }

  @Put()
  save(@CurrentTenant() context: RequestTenantContext, @CurrentUser() user: User, @Body() body: SaveTenantTelegramIntegrationRequest): Promise<TenantTelegramIntegrationDto> {
    return this.integrations.save(context.tenant.id, user.id, body);
  }

  @Post('link-code')
  createLinkCode(@CurrentTenant() context: RequestTenantContext): Promise<TelegramPairingCodeDto> {
    return this.integrations.createPairingCode(context.tenant.id);
  }

  @Post('discover')
  discover(@CurrentTenant() context: RequestTenantContext): Promise<TelegramGroupDiscoveryDto> {
    return this.integrations.discoverGroup(context.tenant.id);
  }

  @Post('confirm')
  confirm(@CurrentTenant() context: RequestTenantContext, @Body() body: ConfirmTelegramGroupRequest): Promise<TenantTelegramIntegrationDto> {
    return this.integrations.confirmGroup(context.tenant.id, body);
  }

  @Post('test')
  test(@CurrentTenant() context: RequestTenantContext): Promise<TelegramIntegrationTestDto> {
    return this.integrations.test(context.tenant.id);
  }

  @Patch('enabled')
  setEnabled(@CurrentTenant() context: RequestTenantContext, @CurrentUser() user: User, @Body() body: { enabled: boolean }): Promise<TenantTelegramIntegrationDto> {
    return this.integrations.save(context.tenant.id, user.id, body);
  }
}
