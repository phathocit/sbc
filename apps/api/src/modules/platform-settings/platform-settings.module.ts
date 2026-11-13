import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';

@Module({
  imports: [AuthModule],
  controllers: [PlatformSettingsController],
  providers: [PlatformSettingsService, PlatformAdminGuard],
  exports: [PlatformSettingsService, PlatformAdminGuard],
})
export class PlatformSettingsModule {}
