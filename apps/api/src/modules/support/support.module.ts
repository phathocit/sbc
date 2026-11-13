import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { PlatformSupportController } from './platform-support.controller';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({ imports: [AuthModule, PlatformSettingsModule], controllers: [SupportController, PlatformSupportController], providers: [SupportService] })
export class SupportModule {}
