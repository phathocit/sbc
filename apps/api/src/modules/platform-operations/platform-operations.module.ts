import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { PlatformOperationsController } from './platform-operations.controller';
import { PlatformOperationsService } from './platform-operations.service';

@Module({ imports: [AuthModule, PlatformSettingsModule], controllers: [PlatformOperationsController], providers: [PlatformOperationsService] })
export class PlatformOperationsModule {}
