import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { PlatformTelegramController } from './platform-telegram.controller';
import { PlatformTelegramService } from './platform-telegram.service';

@Module({ imports: [AuthModule, PlatformSettingsModule], controllers: [PlatformTelegramController], providers: [PlatformTelegramService] })
export class PlatformTelegramModule {}
