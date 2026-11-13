import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { CreateServiceRequest, CreateStaffRequest, ServiceDto, StaffDto, UpdateServiceRequest, UpdateStaffRequest } from '@sbc/contracts';
import { CurrentTenant, RequestTenantContext } from '../../common/decorators/current-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CatalogService } from './catalog.service';

@Controller('catalog')
@UseGuards(AuthGuard, TenantGuard)
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get('services')
  listServices(@CurrentTenant() context: RequestTenantContext): Promise<ServiceDto[]> {
    return this.catalog.listServices(context.tenant.id);
  }

  @Post('services')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  createService(@CurrentTenant() context: RequestTenantContext, @Body() dto: CreateServiceRequest): Promise<ServiceDto> {
    return this.catalog.createService(context.tenant.id, context.location.id, dto);
  }

  @Patch('services/:serviceId')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  updateService(@CurrentTenant() context: RequestTenantContext, @Param('serviceId') id: string, @Body() dto: UpdateServiceRequest): Promise<ServiceDto> {
    return this.catalog.updateService(context.tenant.id, id, dto);
  }

  @Get('staff')
  listStaff(@CurrentTenant() context: RequestTenantContext): Promise<StaffDto[]> {
    return this.catalog.listStaff(context.tenant.id);
  }

  @Post('staff')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  createStaff(@CurrentTenant() context: RequestTenantContext, @Body() dto: CreateStaffRequest): Promise<StaffDto> {
    return this.catalog.createStaff(context.tenant.id, context.location.id, dto);
  }

  @Patch('staff/:staffId')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  updateStaff(@CurrentTenant() context: RequestTenantContext, @Param('staffId') id: string, @Body() dto: UpdateStaffRequest): Promise<StaffDto> {
    return this.catalog.updateStaff(context.tenant.id, id, dto);
  }
}
