import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { CreateSupportMessageRequest, CreateSupportTicketRequest, SupportTicketDto } from '@sbc/contracts';
import type { User } from '@sbc/database';
import { CurrentTenant, type RequestTenantContext } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { SupportService } from './support.service';

@Controller('support/tickets')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('owner', 'admin')
export class SupportController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  @Get()
  list(@CurrentTenant() context: RequestTenantContext): Promise<SupportTicketDto[]> { return this.support.listTenant(context.tenant.id); }

  @Post()
  create(@CurrentTenant() context: RequestTenantContext, @CurrentUser() user: User, @Body() body: CreateSupportTicketRequest): Promise<SupportTicketDto> {
    return this.support.create(context.tenant.id, user.id, body);
  }

  @Get(':ticketId')
  get(@CurrentTenant() context: RequestTenantContext, @Param('ticketId', new ParseUUIDPipe()) ticketId: string): Promise<SupportTicketDto> {
    return this.support.getTenant(context.tenant.id, ticketId);
  }

  @Post(':ticketId/messages')
  reply(@CurrentTenant() context: RequestTenantContext, @CurrentUser() user: User, @Param('ticketId', new ParseUUIDPipe()) ticketId: string, @Body() body: CreateSupportMessageRequest): Promise<SupportTicketDto> {
    return this.support.replyTenant(context.tenant.id, ticketId, user.id, body?.message);
  }
}
