import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantIntegrationsController } from './tenant-integrations.controller';
import { TenantIntegrationsService } from './tenant-integrations.service';

@Module({
  imports: [AuthModule],
  controllers: [TenantIntegrationsController],
  providers: [TenantIntegrationsService],
})
export class TenantIntegrationsModule {}
