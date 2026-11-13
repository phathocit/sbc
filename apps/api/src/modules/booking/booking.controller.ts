import {
  Body, Controller, ForbiddenException, Get, Headers, Inject, Param, Post,
  Query, UseGuards,
} from '@nestjs/common';
import type { AvailabilitySlotDto, BookingCountPointDto, BookingDto, BookingRevenuePointDto, CreateBookingRequest, RescheduleBookingRequest, ServiceBookingCountDto } from '@sbc/contracts';
import type { User } from '@sbc/database';
import { CurrentTenant, RequestTenantContext } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { BookingService } from './booking.service';

@Controller('bookings')
@UseGuards(AuthGuard, TenantGuard)
export class BookingController {
  constructor(@Inject(BookingService) private readonly bookings: BookingService) {}

  private locationId(context: RequestTenantContext): string {
    if (!context.location?.id) throw new ForbiddenException('Active tenant location is required');
    return context.location.id;
  }

  @Get('availability')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  async availability(
    @CurrentTenant() context: RequestTenantContext,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
    @Query('staffId') staffId?: string,
  ): Promise<AvailabilitySlotDto[]> {
    return this.bookings.availability(context.tenant.id, this.locationId(context), serviceId, date, staffId);
  }

  @Get('analytics/counts')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  async bookingCounts(
    @CurrentTenant() context: RequestTenantContext,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<BookingCountPointDto[]> {
    return this.bookings.bookingCounts(context.tenant.id, this.locationId(context), from, to);
  }

  @Get('analytics/services')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  async serviceBookingCounts(
    @CurrentTenant() context: RequestTenantContext,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<ServiceBookingCountDto[]> {
    return this.bookings.serviceBookingCounts(context.tenant.id, this.locationId(context), from, to);
  }

  @Get('analytics/revenue')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  async bookingRevenue(
    @CurrentTenant() context: RequestTenantContext,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<BookingRevenuePointDto[]> {
    return this.bookings.bookingRevenue(context.tenant.id, this.locationId(context), from, to);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  async list(
    @CurrentTenant() context: RequestTenantContext,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<BookingDto[]> {
    const parsedLimit = limit === undefined ? 100 : Number(limit);
    return this.bookings.listBookings(context.tenant.id, parsedLimit, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  async create(
    @CurrentTenant() context: RequestTenantContext,
    @CurrentUser() user: User,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: CreateBookingRequest,
  ): Promise<BookingDto> {
    return this.bookings.createBooking(context.tenant.id, this.locationId(context), user.id, key, dto);
  }

  @Post(':bookingId/approve')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  approve(
    @CurrentTenant() context: RequestTenantContext,
    @CurrentUser() user: User,
    @Headers('idempotency-key') key: string | undefined,
    @Param('bookingId') bookingId: string,
  ): Promise<BookingDto> {
    return this.bookings.approve(context.tenant.id, user.id, key, bookingId);
  }

  @Post(':bookingId/cancel')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  cancel(
    @CurrentTenant() context: RequestTenantContext,
    @CurrentUser() user: User,
    @Headers('idempotency-key') key: string | undefined,
    @Param('bookingId') bookingId: string,
  ): Promise<BookingDto> {
    return this.bookings.cancel(context.tenant.id, user.id, key, bookingId);
  }

  @Post(':bookingId/reschedule')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  reschedule(
    @CurrentTenant() context: RequestTenantContext,
    @CurrentUser() user: User,
    @Headers('idempotency-key') key: string | undefined,
    @Param('bookingId') bookingId: string,
    @Body() dto: RescheduleBookingRequest,
  ): Promise<BookingDto> {
    return this.bookings.reschedule(context.tenant.id, this.locationId(context), user.id, key, bookingId, dto);
  }

  @Post(':bookingId/complete')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  complete(
    @CurrentTenant() context: RequestTenantContext,
    @CurrentUser() user: User,
    @Headers('idempotency-key') key: string | undefined,
    @Param('bookingId') bookingId: string,
  ): Promise<BookingDto> {
    return this.bookings.complete(context.tenant.id, user.id, key, bookingId);
  }

  @Post(':bookingId/no-show')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'receptionist')
  noShow(
    @CurrentTenant() context: RequestTenantContext,
    @CurrentUser() user: User,
    @Headers('idempotency-key') key: string | undefined,
    @Param('bookingId') bookingId: string,
  ): Promise<BookingDto> {
    return this.bookings.noShow(context.tenant.id, user.id, key, bookingId);
  }
}
