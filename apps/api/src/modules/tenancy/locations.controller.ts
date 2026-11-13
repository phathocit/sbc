import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  UseGuards,
} from '@nestjs/common';
import type { LocationDto, UpdateLocationRequest } from '@sbc/contracts';
import { CurrentTenant, RequestTenantContext } from '../../common/decorators/current-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenancyService } from './tenancy.service';

@Controller('locations')
@UseGuards(AuthGuard, TenantGuard)
export class LocationsController {
  constructor(@Inject(TenancyService) private readonly tenancyService: TenancyService) {}

  @Get('current')
  async getCurrentLocation(
    @CurrentTenant() context: RequestTenantContext,
  ): Promise<LocationDto> {
    return this.tenancyService.getCurrentLocation(context.tenant.id);
  }

  @Patch('current')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  async updateCurrentLocation(
    @CurrentTenant() context: RequestTenantContext,
    @Body() dto: UpdateLocationRequest,
  ): Promise<LocationDto> {
    return this.tenancyService.updateCurrentLocation(context.tenant.id, dto);
  }
}
