import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { BillingModule } from '../billing/billing.module';
import { PlatformTenantsController } from './platform-tenants.controller';
import { TenantApplicationsController } from './tenant-applications.controller';
import { TenantManagementService } from './tenant-management.service';
import { PlatformNotificationEventsService } from './platform-notification-events.service';

@Module({
  imports: [AuthModule, PlatformSettingsModule, BillingModule],
  controllers: [TenantApplicationsController, PlatformTenantsController],
  providers: [TenantManagementService, PlatformNotificationEventsService],
})
export class TenantManagementModule {}
