import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { resolve } from 'node:path';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { validateEnvironment } from './config/environment';
import { HealthController } from './health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { BookingModule } from './modules/booking/booking.module';
import { PublicBookingModule } from './modules/public-booking/public-booking.module';
import { PlatformSettingsModule } from './modules/platform-settings/platform-settings.module';
import { TenantManagementModule } from './modules/tenant-management/tenant-management.module';
import { BillingModule } from './modules/billing/billing.module';
import { TenantNotificationsModule } from './modules/tenant-notifications/tenant-notifications.module';
import { TenantIntegrationsModule } from './modules/tenant-integrations/tenant-integrations.module';
import { SupportModule } from './modules/support/support.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, '../../../.env'),
      validate: validateEnvironment,
    }),
    AuthModule,
    TenancyModule,
    MembershipsModule,
    CatalogModule,
    BookingModule,
    PublicBookingModule,
    PlatformSettingsModule,
    TenantManagementModule,
    BillingModule,
    TenantNotificationsModule,
    TenantIntegrationsModule,
    SupportModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
