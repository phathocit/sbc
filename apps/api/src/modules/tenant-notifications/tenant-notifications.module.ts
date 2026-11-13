import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantNotificationsController } from './tenant-notifications.controller';
import { TenantNotificationEventsService } from './tenant-notification-events.service';
import { TenantNotificationsService } from './tenant-notifications.service';

@Module({
  imports: [AuthModule],
  controllers: [TenantNotificationsController],
  providers: [TenantNotificationsService, TenantNotificationEventsService],
})
export class TenantNotificationsModule {}
