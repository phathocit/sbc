import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { ClaimTenantInvitationRequest, CompleteTenantInvitationRequest, CreateTenantApplicationRequest, PublicTenantApplicationRequest, TenantApplicationDto } from '@sbc/contracts';
import type { User } from '@sbc/database';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantManagementService } from './tenant-management.service';

@Controller('tenant-applications')
export class TenantApplicationsController {
  constructor(@Inject(TenantManagementService) private readonly management: TenantManagementService) {}

  @Post()
  @UseGuards(AuthGuard)
  submit(@CurrentUser() user: User, @Body() body: CreateTenantApplicationRequest): Promise<TenantApplicationDto> {
    return this.management.submitApplication(user, body);
  }

  @Public()
  @Post('public')
  submitPublic(@Body() body: PublicTenantApplicationRequest, @Req() request: Request): Promise<{ accepted: true }> {
    return this.management.submitPublicApplication(body, request);
  }

  @Public()
  @Post('complete-invitation')
  completeInvitation(@Body() body: CompleteTenantInvitationRequest, @Req() request: Request): Promise<{ completed: true }> {
    return this.management.completeOwnerInvitation(body, request);
  }

  @UseGuards(AuthGuard)
  @Post('claim-invitation')
  claimInvitation(@CurrentUser() user: User, @Body() body: ClaimTenantInvitationRequest, @Req() request: Request): Promise<{ completed: true; tenantId: string }> {
    return this.management.claimOwnerInvitation(user, body, request);
  }

  @Get('mine')
  @UseGuards(AuthGuard)
  mine(@CurrentUser() user: User): Promise<TenantApplicationDto | null> {
    return this.management.getMyApplication(user.id);
  }
}
