import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { LocationsController } from './locations.controller';
import { TenantPoliciesController } from './tenant-policies.controller';
import { TenantsController } from './tenants.controller';
import { TenancyService } from './tenancy.service';

@Module({
  imports: [AuthModule, PlatformSettingsModule],
  controllers: [TenantsController, TenantPoliciesController, LocationsController],
  providers: [TenancyService],
  exports: [TenancyService],
})
export class TenancyModule {}
