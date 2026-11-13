import {
  BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  AvailabilitySlotDto, BookingScheduleSuggestionDto, GuestAccessRequest, GuestRescheduleRequest, PublicTenantPageDto,
  GuestSessionResponse, GuestTokenRedemptionRequest, PublicBookingSummary, PublicStaffDto,
  PublicCreateBookingRequest, PublicServiceDto,
} from '@sbc/contracts';
import { PublicBookingService } from './public-booking.service';

@Controller('public/:slug')
export class PublicBookingController {
  constructor(@Inject(PublicBookingService) private readonly publicBookings: PublicBookingService) {}

  @Get('services')
  services(@Param('slug') slug: string, @Req() request: Request): Promise<PublicServiceDto[]> {
    return this.publicBookings.services(slug, request);
  }

  @Get('page')
  page(@Param('slug') slug: string, @Req() request: Request): Promise<PublicTenantPageDto> {
    return this.publicBookings.page(slug, request);
  }

  @Get('services/:serviceId/staff')
  staff(@Param('slug') slug: string, @Param('serviceId') serviceId: string, @Req() request: Request): Promise<PublicStaffDto[]> {
    return this.publicBookings.staff(slug, serviceId, request);
  }

  @Get('availability')
  availability(
    @Param('slug') slug: string,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
    @Query('staffId') staffId: string | undefined,
    @Query('serviceIds') serviceIds: string | undefined,
    @Req() request: Request,
  ): Promise<AvailabilitySlotDto[]> {
    return this.publicBookings.availability(slug, serviceId, date, staffId, request, serviceIds?.split(',').filter(Boolean));
  }

  @Get('availability/suggestions')
  scheduleSuggestions(
    @Param('slug') slug: string,
    @Query('serviceIds') serviceIds: string,
    @Query('date') date: string,
    @Query('staffByService') staffByService: string | undefined,
    @Req() request: Request,
  ): Promise<BookingScheduleSuggestionDto[]> {
    let preferences: Record<string, string | undefined> = {};
    if (staffByService) {
      try { preferences = JSON.parse(staffByService) as Record<string, string | undefined>; }
      catch { throw new BadRequestException('staffByService must be valid JSON'); }
    }
    return this.publicBookings.scheduleSuggestions(slug, serviceIds.split(',').filter(Boolean), date, preferences, request);
  }

  @Post('bookings')
  @HttpCode(201)
  create(
    @Param('slug') slug: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: PublicCreateBookingRequest,
    @Req() request: Request,
  ): Promise<PublicBookingSummary> {
    return this.publicBookings.create(slug, key, body, request);
  }

  @Post('bookings/recover')
  @HttpCode(200)
  recover(
    @Param('slug') slug: string,
    @Body() body: { idempotencyKey?: string; contact?: string },
    @Req() request: Request,
  ): Promise<{ found: false } | { found: true; booking: PublicBookingSummary; timezone: string }> {
    return this.publicBookings.recover(slug, body, request);
  }

  @Post('guest-access/request-link')
  @HttpCode(202)
  requestLink(@Param('slug') slug: string, @Body() body: GuestAccessRequest, @Req() request: Request): Promise<{ accepted: true }> {
    return this.publicBookings.requestLink(slug, body, request);
  }

  @Post('guest-access/redeem')
  @HttpCode(200)
  redeem(@Param('slug') slug: string, @Body() body: GuestTokenRedemptionRequest, @Req() request: Request): Promise<GuestSessionResponse> {
    return this.publicBookings.redeem(slug, body, request);
  }

  @Get('bookings/:bookingId/manage')
  manage(@Param('slug') slug: string, @Param('bookingId') bookingId: string, @Headers('authorization') authorization: string | undefined, @Req() request: Request): Promise<PublicBookingSummary> {
    return this.publicBookings.manage(slug, bookingId, authorization, request);
  }

  @Post('bookings/:bookingId/cancel')
  @HttpCode(200)
  cancel(@Param('slug') slug: string, @Param('bookingId') bookingId: string, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string | undefined, @Req() request: Request): Promise<PublicBookingSummary> {
    return this.publicBookings.cancel(slug, bookingId, authorization, key, request);
  }

  @Post('bookings/:bookingId/reschedule')
  @HttpCode(200)
  reschedule(
    @Param('slug') slug: string,
    @Param('bookingId') bookingId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: GuestRescheduleRequest,
    @Req() request: Request,
  ): Promise<PublicBookingSummary> {
    return this.publicBookings.reschedule(slug, bookingId, authorization, key, body, request);
  }
}
