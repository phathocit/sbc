import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { CreateSupportMessageRequest, SupportTicketDto, UpdateSupportTicketStatusRequest } from '@sbc/contracts';
import type { User } from '@sbc/database';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PlatformAdminGuard } from '../platform-settings/platform-admin.guard';
import { SupportService } from './support.service';

@Controller('platform/support/tickets')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class PlatformSupportController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  @Get()
  list(@Query('status') status?: string, @Query('search') search?: string): Promise<SupportTicketDto[]> {
    return this.support.listPlatform(status, search);
  }

  @Get(':ticketId')
  get(@Param('ticketId', new ParseUUIDPipe()) ticketId: string): Promise<SupportTicketDto> { return this.support.getPlatform(ticketId); }

  @Post(':ticketId/messages')
  reply(@CurrentUser() user: User, @Param('ticketId', new ParseUUIDPipe()) ticketId: string, @Body() body: CreateSupportMessageRequest): Promise<SupportTicketDto> {
    return this.support.replyPlatform(ticketId, user.id, body?.message);
  }

  @Patch(':ticketId/status')
  setStatus(@Param('ticketId', new ParseUUIDPipe()) ticketId: string, @Body() body: UpdateSupportTicketStatusRequest): Promise<SupportTicketDto> {
    return this.support.setStatus(ticketId, body?.status);
  }
}
