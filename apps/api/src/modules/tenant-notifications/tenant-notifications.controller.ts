import { BadRequestException, Controller, Get, Header, Inject, Param, ParseUUIDPipe, Patch, Query, Sse, UseGuards, type MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { TenantNotificationPageDto } from '@sbc/contracts';
import type { User } from '@sbc/database';
import { CurrentTenant, type RequestTenantContext } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantNotificationEventsService } from './tenant-notification-events.service';
import { TenantNotificationsService } from './tenant-notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('owner')
export class TenantNotificationsController {
  constructor(
    @Inject(TenantNotificationsService) private readonly notifications: TenantNotificationsService,
    @Inject(TenantNotificationEventsService) private readonly events: TenantNotificationEventsService,
  ) {}

  @Get()
  list(@CurrentTenant() context: RequestTenantContext, @CurrentUser() user: User, @Query('page') rawPage?: string): Promise<TenantNotificationPageDto> {
    const page = rawPage === undefined ? 1 : Number(rawPage);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new BadRequestException('Trang không hợp lệ.');
    return this.notifications.list(context.tenant.id, user.id, page);
  }

  @Sse('stream')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('X-Accel-Buffering', 'no')
  stream(@CurrentTenant() context: RequestTenantContext): Observable<MessageEvent> {
    return this.events.stream(context.tenant.id);
  }

  @Patch('read-all')
  markAllRead(@CurrentTenant() context: RequestTenantContext, @CurrentUser() user: User): Promise<{ read: true }> {
    return this.notifications.markAllRead(context.tenant.id, user.id);
  }

  @Patch(':notificationId/read')
  markRead(@CurrentTenant() context: RequestTenantContext, @CurrentUser() user: User, @Param('notificationId', new ParseUUIDPipe()) notificationId: string): Promise<{ read: true }> {
    return this.notifications.markRead(context.tenant.id, user.id, notificationId);
  }
}
