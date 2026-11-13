import { Body, Controller, Get, Inject, Post, Put, UseGuards } from '@nestjs/common';
import type {
  PlatformAdminBootstrapRequest,
  PlatformAdminBootstrapResponse,
  PlatformAdminBootstrapStatus,
  PlatformSettingsStatus,
  PlatformSettingsTestResult,
  TestPlatformSettingsRequest,
  UnlockPlatformSettingsRequest,
  UpdatePlatformSettingsRequest,
} from '@sbc/contracts';
import type { User } from '@sbc/database';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformSettingsService } from './platform-settings.service';

@Controller('platform-settings')
export class PlatformSettingsController {
  constructor(@Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService) {}

  @UseGuards(AuthGuard)
  @Get('bootstrap-status')
  bootstrapStatus(): Promise<PlatformAdminBootstrapStatus> {
    return this.settings.bootstrapStatus();
  }

  @UseGuards(AuthGuard)
  @Post('bootstrap')
  bootstrap(
    @CurrentUser() user: User,
    @Body() body: PlatformAdminBootstrapRequest,
  ): Promise<PlatformAdminBootstrapResponse> {
    return this.settings.bootstrapAdmin(user, body?.token);
  }

  @UseGuards(AuthGuard, PlatformAdminGuard)
  @Get()
  getSettings(): Promise<PlatformSettingsStatus> {
    return this.settings.safeSettings();
  }

  @UseGuards(AuthGuard, PlatformAdminGuard)
  @Post('unlock')
  unlockSettings(
    @CurrentUser() user: User,
    @Body() body: UnlockPlatformSettingsRequest,
  ): Promise<{ unlocked: true }> {
    return this.settings.unlockSettings(user, body?.currentPassword);
  }

  @UseGuards(AuthGuard, PlatformAdminGuard)
  @Put()
  updateSettings(
    @CurrentUser() user: User,
    @Body() body: UpdatePlatformSettingsRequest,
  ): Promise<PlatformSettingsStatus> {
    return this.settings.updateSettings(user, body);
  }

  @UseGuards(AuthGuard, PlatformAdminGuard)
  @Post('test')
  testSettings(
    @CurrentUser() user: User,
    @Body() body: TestPlatformSettingsRequest,
  ): Promise<PlatformSettingsTestResult> {
    return this.settings.testConfiguration(user, body);
  }
}
