import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  CreateMembershipRequest,
  MembershipDto,
  UpdateMembershipRequest,
} from '@sbc/contracts';
import { CurrentTenant, RequestTenantContext } from '../../common/decorators/current-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { MembershipsService } from './memberships.service';

@Controller('memberships')
@UseGuards(AuthGuard, TenantGuard)
export class MembershipsController {
  constructor(@Inject(MembershipsService) private readonly membershipsService: MembershipsService) {}

  @Get()
  async listMembers(
    @CurrentTenant() context: RequestTenantContext,
  ): Promise<MembershipDto[]> {
    return this.membershipsService.listMembers(context.tenant.id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  async addMember(
    @CurrentTenant() context: RequestTenantContext,
    @Body() dto: CreateMembershipRequest,
  ): Promise<MembershipDto> {
    return this.membershipsService.addMember(context.tenant.id, dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  async updateMember(
    @CurrentTenant() context: RequestTenantContext,
    @Param('id') membershipId: string,
    @Body() dto: UpdateMembershipRequest,
  ): Promise<MembershipDto> {
    return this.membershipsService.updateMember(
      context.tenant.id,
      membershipId,
      dto,
    );
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  async removeMember(
    @CurrentTenant() context: RequestTenantContext,
    @Param('id') membershipId: string,
  ): Promise<{ success: boolean }> {
    return this.membershipsService.removeMember(
      context.tenant.id,
      membershipId,
    );
  }
}
