import { Body, Controller, Get, Inject, Post, Put, UseGuards } from '@nestjs/common';
import type { PlatformTelegramChatDiscoveryDto, PlatformTelegramIntegrationDto, PlatformTelegramPairingCodeDto, SavePlatformTelegramIntegrationRequest, TestPlatformTelegramIntegrationRequest } from '@sbc/contracts';
import type { User } from '@sbc/database';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PlatformAdminGuard } from '../platform-settings/platform-admin.guard';
import { PlatformTelegramService } from './platform-telegram.service';

@Controller('platform/telegram')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class PlatformTelegramController {
  constructor(@Inject(PlatformTelegramService) private readonly telegram: PlatformTelegramService) {}

  @Get()
  status(): Promise<PlatformTelegramIntegrationDto> { return this.telegram.status(); }

  @Put()
  save(@CurrentUser() user: User, @Body() body: SavePlatformTelegramIntegrationRequest): Promise<PlatformTelegramIntegrationDto> {
    return this.telegram.save(user, body);
  }

  @Post('discover')
  discover(@CurrentUser() user: User, @Body() body: TestPlatformTelegramIntegrationRequest): Promise<PlatformTelegramChatDiscoveryDto> {
    return this.telegram.discover(user, body?.currentPassword);
  }

  @Post('pairing-code')
  pairingCode(@CurrentUser() user: User, @Body() body: TestPlatformTelegramIntegrationRequest): Promise<PlatformTelegramPairingCodeDto> {
    return this.telegram.createPairingCode(user, body?.currentPassword);
  }

  @Post('test')
  test(@CurrentUser() user: User, @Body() body: TestPlatformTelegramIntegrationRequest): Promise<PlatformTelegramIntegrationDto> {
    return this.telegram.test(user, body);
  }
}
