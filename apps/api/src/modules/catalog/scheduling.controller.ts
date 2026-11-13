import { BadRequestException, Body, Controller, Get, Inject, Param, ParseIntPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import type { CreateScheduleExceptionRequest, CreateStaffShiftTemplateRequest, ScheduleExceptionDto, StaffShiftTemplateDto, WeeklyWorkingHoursRequest, WorkingHourDto, WorkingHoursRequest } from '@sbc/contracts';
import { CurrentTenant, RequestTenantContext } from '../../common/decorators/current-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CatalogService } from './catalog.service';

@Controller('scheduling')
@UseGuards(AuthGuard, TenantGuard)
export class SchedulingController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get('business-hours')
  listBusinessHours(@CurrentTenant() context: RequestTenantContext): Promise<WorkingHourDto[]> {
    return this.catalog.listBusinessHours(context.tenant.id, context.location.id);
  }

  @Put('business-hours/week')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  setBusinessHoursWeek(@CurrentTenant() context: RequestTenantContext, @Body() dto: WeeklyWorkingHoursRequest): Promise<WorkingHourDto[]> {
    const locationId = context.location?.id;
    if (!locationId) throw new BadRequestException('An active tenant location is required');
    return this.catalog.setBusinessHoursWeek(context.tenant.id, locationId, dto);
  }

  @Put('business-hours/:weekday')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  setBusinessHours(@CurrentTenant() context: RequestTenantContext, @Param('weekday', ParseIntPipe) weekday: number, @Body() dto: Omit<WorkingHoursRequest, 'weekday'>): Promise<WorkingHourDto[]> {
    return this.catalog.setBusinessHours(context.tenant.id, context.location.id, { ...dto, weekday });
  }

  @Get('staff/:staffId/hours')
  listStaffHours(@CurrentTenant() context: RequestTenantContext, @Param('staffId') staffId: string): Promise<WorkingHourDto[]> {
    return this.catalog.listStaffHours(context.tenant.id, staffId);
  }

  @Put('staff/:staffId/hours/:weekday')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  setStaffHours(@CurrentTenant() context: RequestTenantContext, @Param('staffId') staffId: string, @Param('weekday', ParseIntPipe) weekday: number, @Body() dto: Omit<WorkingHoursRequest, 'weekday'>): Promise<WorkingHourDto[]> {
    return this.catalog.setStaffHours(context.tenant.id, staffId, { ...dto, weekday });
  }

  @Get('staff-shifts')
  listStaffShiftTemplates(@CurrentTenant() context: RequestTenantContext): Promise<StaffShiftTemplateDto[]> {
    return this.catalog.listStaffShiftTemplates(context.tenant.id);
  }

  @Post('staff-shifts')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  createStaffShiftTemplate(@CurrentTenant() context: RequestTenantContext, @Body() dto: CreateStaffShiftTemplateRequest): Promise<StaffShiftTemplateDto> {
    return this.catalog.createStaffShiftTemplate(context.tenant.id, dto);
  }

  @Patch('staff-shifts/:templateId')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  updateStaffShiftTemplate(@CurrentTenant() context: RequestTenantContext, @Param('templateId') id: string, @Body() dto: CreateStaffShiftTemplateRequest): Promise<StaffShiftTemplateDto> {
    return this.catalog.updateStaffShiftTemplate(context.tenant.id, id, dto);
  }

  @Get('exceptions')
  listExceptions(@CurrentTenant() context: RequestTenantContext): Promise<ScheduleExceptionDto[]> {
    return this.catalog.listExceptions(context.tenant.id);
  }

  @Post('exceptions')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  createException(@CurrentTenant() context: RequestTenantContext, @Body() dto: CreateScheduleExceptionRequest): Promise<ScheduleExceptionDto> {
    return this.catalog.createException(context.tenant.id, context.location.id, dto);
  }

  @Patch('exceptions/:exceptionId/deactivate')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  deactivateException(@CurrentTenant() context: RequestTenantContext, @Param('exceptionId') id: string): Promise<ScheduleExceptionDto> {
    return this.catalog.deactivateException(context.tenant.id, id);
  }
}
