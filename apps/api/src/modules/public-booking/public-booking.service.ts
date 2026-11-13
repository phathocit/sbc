import {
  BadRequestException, Inject, Injectable,
  NotFoundException, ServiceUnavailableException, TooManyRequestsException,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  AvailabilitySlotDto, BookingDto, BookingScheduleSuggestionDto, GuestAccessRequest, GuestRescheduleRequest,
  GuestSessionResponse, GuestTokenRedemptionRequest, PublicBookingSummary, PublicStaffDto, PublicTenantPageDto, TenantThemeKey, TenantThemeMode,
  PublicCreateBookingRequest, PublicServiceDto,
} from '@sbc/contracts';
import {
  and, asc, eq, gt, isNull, lt, or, sql,
} from 'drizzle-orm';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import {
  bookingAllocations, bookingEvents, bookings, customers, guestAccessSessions, idempotencyRecords,
  guestAccessTokens, locations, outboxMessages, publicRateLimits, services, staffProfiles, staffServices, tenants,
} from '../../../../../packages/database/dist/schema/index.js';
import { db } from '../../database';
import { BookingService, type PublicBookingCredential } from '../booking/booking.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

const TOKEN_TTL_MS = 30 * 60_000;
const SESSION_TTL_MS = 15 * 60_000;
const RATE_WINDOW_MS = 60_000;
const BASE64URL_TOKEN = /^[A-Za-z0-9_-]{43}$/;

type PublicContext = { tenantId: string; locationId: string };
type GuestSession = { id: string; tenantId: string; bookingId: string };

@Injectable()
export class PublicBookingService {
  constructor(
    @Inject(BookingService) private readonly bookingsService: BookingService,
    @Inject(PlatformSettingsService) private readonly platformSettings: PlatformSettingsService,
  ) {}

  private rateLimitKey(): Buffer {
    const value = process.env.APP_CONFIG_MASTER_KEY?.trim() || process.env.GUEST_TOKEN_ENCRYPTION_KEY?.trim() || '';
    if (!/^[0-9a-f]{64}$/i.test(value)) {
      throw new ServiceUnavailableException({ errorCode: 'GUEST_ACCESS_UNAVAILABLE', message: 'Guest booking is temporarily unavailable' });
    }
    return createHmac('sha256', Buffer.from(value, 'hex')).update('public-rate-limit-key-v1').digest();
  }

  private digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private encryptDelivery(recipient: string, slug: string, token: string, keyId: string, keyValue: string): Record<string, string> {
    const key = Buffer.from(keyValue, 'hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plaintext = JSON.stringify({ recipient, relativeUrl: `/public/${slug}/manage#token=${token}` });
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      keyId,
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    };
  }

  private normalizeEmail(value: unknown): string | null {
    const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!email) return null;
    if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('A valid email is required');
    return email;
  }

  private normalizePhone(value: unknown): string {
    const phone = typeof value === 'string' ? value.replace(/[\s().-]/g, '') : '';
    if (!/^\+?[0-9]{9,15}$/.test(phone)) throw new BadRequestException('A valid phone number is required');
    return phone;
  }

  private guestActorUuid(tenantId: string, contact: string): string {
    const actorId = createHash('sha256').update(`guest-actor-v1\0${tenantId}\0${contact}`).digest('hex');
    return `${actorId.slice(0, 8)}-${actorId.slice(8, 12)}-4${actorId.slice(13, 16)}-8${actorId.slice(17, 20)}-${actorId.slice(20, 32)}`;
  }

  private async enforceCancellationAbuseLimit(tenantId: string, phone: string, email: string | null): Promise<void> {
    const identityFilters = [eq(customers.phoneNormalized, phone)];
    if (email) identityFilters.push(eq(customers.emailNormalized, email));
    const [activity] = await db.select({
      recentBookings: sql<number>`count(DISTINCT ${bookings.id}) FILTER (WHERE ${bookings.createdAt} >= now() - interval '30 days' OR (${bookingEvents.actorType} = 'guest' AND ${bookingEvents.eventType} = 'booking.cancelled' AND ${bookingEvents.occurredAt} >= now() - interval '30 days'))::int`,
      recentCancellations: sql<number>`count(DISTINCT ${bookingEvents.bookingId}) FILTER (WHERE ${bookingEvents.actorType} = 'guest' AND ${bookingEvents.eventType} = 'booking.cancelled' AND ${bookingEvents.occurredAt} >= now() - interval '30 days')::int`,
    }).from(bookings).innerJoin(customers, and(eq(customers.tenantId, bookings.tenantId), eq(customers.id, bookings.customerId)))
      .innerJoin(bookingEvents, and(eq(bookingEvents.tenantId, bookings.tenantId), eq(bookingEvents.bookingId, bookings.id)))
      .where(and(eq(bookings.tenantId, tenantId), or(...identityFilters)));
    const created = Number(activity?.recentBookings ?? 0);
    const cancelled = Number(activity?.recentCancellations ?? 0);
    // Require both sustained volume and a high cancellation ratio; ordinary cancellations do not throttle a customer.
    if (created >= 8 && cancelled >= 5 && cancelled / created >= 0.6) {
      throw new TooManyRequestsException({ errorCode: 'REPEATED_CANCELLATION_LIMIT', message: 'Không thể nhận thêm yêu cầu đặt lịch lúc này. Vui lòng liên hệ trực tiếp với tiệm để được hỗ trợ.' });
    }
  }

  private clientAddress(request: Request): string {
    // Only the socket peer is trusted. Forwarded headers are intentionally ignored.
    const address = request.socket.remoteAddress;
    if (!address || address.length > 128) throw new BadRequestException('Client address is unavailable');
    return address;
  }

  private async enforceRateLimit(request: Request, action: string, limit: number, tenantId?: string, email?: string): Promise<void> {
    const key = this.rateLimitKey();
    const bucketMs = Math.floor(Date.now() / RATE_WINDOW_MS) * RATE_WINDOW_MS;
    const windowStart = new Date(bucketMs);
    const input = `${action}:${tenantId ?? 'public'}:${this.clientAddress(request)}:${email ?? ''}`;
    const keyHash = createHmac('sha256', key).update('public-rate-limit-v1\0').update(input).digest('hex');
    const [row] = await db.insert(publicRateLimits).values({ keyHash, windowStart, requestCount: 1 })
      .onConflictDoUpdate({
        target: [publicRateLimits.keyHash, publicRateLimits.windowStart],
        set: { requestCount: sql`${publicRateLimits.requestCount} + 1` },
      }).returning({ requestCount: publicRateLimits.requestCount });
    if (row && row.requestCount > limit) throw new TooManyRequestsException({ errorCode: 'PUBLIC_RATE_LIMITED', message: 'Too many requests; try again later' });
    // Opportunistic bounded-retention cleanup; no IP or email value is persisted.
    await db.delete(publicRateLimits).where(lt(publicRateLimits.createdAt, new Date(Date.now() - 48 * 60 * 60_000)));
  }

  private async resolve(slug: string): Promise<PublicContext & { slug: string }> {
    const normalizedSlug = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalizedSlug)) throw new NotFoundException('Public booking page not found');
    const [row] = await db.select({ tenantId: tenants.id, slug: tenants.slug, locationId: locations.id })
      .from(tenants).innerJoin(locations, and(eq(locations.tenantId, tenants.id), eq(locations.active, true)))
      .where(and(eq(tenants.slug, normalizedSlug), eq(tenants.status, 'active'))).orderBy(asc(locations.createdAt)).limit(1);
    if (!row) throw new NotFoundException('Public booking page not found');
    return row;
  }

  private async publishedService(context: PublicContext, serviceId: string) {
    if (typeof serviceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(serviceId)) throw new BadRequestException('serviceId must be a UUID');
    const [service] = await db.select().from(services).where(and(
      eq(services.tenantId, context.tenantId), eq(services.id, serviceId),
      eq(services.active, true), eq(services.published, true),
    )).limit(1);
    if (!service) throw new NotFoundException('Published service not found');
    return service;
  }

  async page(slug: string, request: Request): Promise<PublicTenantPageDto> {
    const context = await this.resolve(slug);
    await this.enforceRateLimit(request, 'page', 120, context.tenantId);
    const [tenant] = await db.select({ slug: tenants.slug, displayName: tenants.displayName, themeKey: tenants.themeKey, themeMode: tenants.themeMode })
      .from(tenants).where(eq(tenants.id, context.tenantId)).limit(1);
    if (!tenant) throw new NotFoundException('Public booking page not found');
    return { ...tenant, themeKey: tenant.themeKey as TenantThemeKey | null, themeMode: tenant.themeMode as TenantThemeMode };
  }

  async services(slug: string, request: Request): Promise<PublicServiceDto[]> {
    const context = await this.resolve(slug);
    await this.enforceRateLimit(request, 'services', 120, context.tenantId);
    const rows = await db.select().from(services).where(and(
      eq(services.tenantId, context.tenantId), eq(services.active, true), eq(services.published, true),
    )).orderBy(asc(services.name));
    return rows.map((row) => ({ id: row.id, name: row.name, description: row.description,
      durationMinutes: row.durationMinutes, priceMinor: row.priceMinor, currency: row.currency }));
  }

  async staff(slug: string, serviceId: string, request: Request): Promise<PublicStaffDto[]> {
    const context = await this.resolve(slug);
    await this.enforceRateLimit(request, 'staff', 120, context.tenantId);
    await this.publishedService(context, serviceId);
    const rows = await db.select({ id: staffProfiles.id, name: staffProfiles.name })
      .from(staffServices).innerJoin(staffProfiles, and(
        eq(staffProfiles.tenantId, staffServices.tenantId), eq(staffProfiles.id, staffServices.staffId),
      )).where(and(
        eq(staffServices.tenantId, context.tenantId), eq(staffServices.serviceId, serviceId),
        eq(staffProfiles.locationId, context.locationId), eq(staffProfiles.active, true),
      )).orderBy(asc(staffProfiles.name), asc(staffProfiles.id));
    return rows;
  }

  async availability(slug: string, serviceId: string, date: string, staffId: string | undefined, request: Request, serviceIds?: string[]): Promise<AvailabilitySlotDto[]> {
    const context = await this.resolve(slug);
    await this.enforceRateLimit(request, 'availability', 120, context.tenantId);
    for (const id of serviceIds?.length ? serviceIds : [serviceId]) await this.publishedService(context, id);
    return this.bookingsService.availability(context.tenantId, context.locationId, serviceId, date, staffId, true, serviceIds);
  }

  async scheduleSuggestions(slug: string, serviceIds: string[], date: string, staffByService: Record<string, string | undefined>, request: Request): Promise<BookingScheduleSuggestionDto[]> {
    const context = await this.resolve(slug);
    await this.enforceRateLimit(request, 'availability', 120, context.tenantId);
    for (const id of serviceIds) await this.publishedService(context, id);
    return this.bookingsService.scheduleSuggestions(context.tenantId, context.locationId, serviceIds, date, staffByService, true);
  }

  async create(slug: string, idempotencyKey: string | undefined, dto: PublicCreateBookingRequest, request: Request): Promise<PublicBookingSummary> {
    if (!dto || typeof dto !== 'object') throw new BadRequestException('A booking request body is required');
    const email = this.normalizeEmail(dto.customerEmail);
    const phone = this.normalizePhone(dto.customerPhone);
    const context = await this.resolve(slug);
    await this.enforceRateLimit(request, 'create', 10, context.tenantId, email ?? phone);
    if (dto.serviceIds !== undefined && (!Array.isArray(dto.serviceIds) || dto.serviceIds.some((id) => typeof id !== 'string'))) throw new BadRequestException('serviceIds must be a list of service IDs');
    const serviceIds = dto.serviceIds?.length ? dto.serviceIds : [dto.serviceId];
    if (serviceIds.length > 3 || serviceIds[0] !== dto.serviceId || new Set(serviceIds).size !== serviceIds.length) throw new BadRequestException('Choose between one and three unique services');
    for (const id of serviceIds) await this.publishedService(context, id);
    let credential: PublicBookingCredential = {};
    if (email) {
      const activeGuestKey = await this.platformSettings.activeGuestTokenKey();
      const token = randomBytes(32).toString('base64url');
      const now = new Date();
      credential = {
        tokenHash: this.digest(token),
        expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
        encryptedPayload: this.encryptDelivery(email, slug, token, activeGuestKey.keyId, activeGuestKey.key),
      };
    }
    const actorUuid = this.guestActorUuid(context.tenantId, email ?? phone);
    const hasPriorAttempt = typeof idempotencyKey === 'string' && idempotencyKey.length <= 255
      ? Boolean((await db.select({ id: idempotencyRecords.id }).from(idempotencyRecords).where(and(
        eq(idempotencyRecords.tenantId, context.tenantId), eq(idempotencyRecords.actorId, actorUuid),
        eq(idempotencyRecords.operation, 'booking.create'), eq(idempotencyRecords.key, idempotencyKey),
      )).limit(1))[0])
      : false;
    if (!hasPriorAttempt) await this.enforceCancellationAbuseLimit(context.tenantId, phone, email);
    const booking = await this.bookingsService.createBooking(context.tenantId, context.locationId, actorUuid, idempotencyKey, { ...dto, customerEmail: email ?? undefined, customerPhone: phone }, credential);
    return this.publicSummary(booking);
  }

  async recover(slug: string, body: { idempotencyKey?: string; contact?: string }, request: Request): Promise<{ found: false } | { found: true; booking: PublicBookingSummary; timezone: string }> {
    const context = await this.resolve(slug);
    const key = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new BadRequestException('A valid booking attempt key is required');
    const rawContact = typeof body?.contact === 'string' ? body.contact.trim() : '';
    const email = rawContact.includes('@') ? this.normalizeEmail(rawContact) : null;
    const phone = email ? null : this.normalizePhone(rawContact);
    const contact = email ?? phone!;
    await this.enforceRateLimit(request, 'booking-recovery', 5, context.tenantId, contact);
    const actorUuid = this.guestActorUuid(context.tenantId, contact);
    const [record] = await db.select({ bookingId: idempotencyRecords.resultBookingId }).from(idempotencyRecords).where(and(
      eq(idempotencyRecords.tenantId, context.tenantId), eq(idempotencyRecords.actorId, actorUuid),
      eq(idempotencyRecords.operation, 'booking.create'), eq(idempotencyRecords.key, key), gt(idempotencyRecords.expiresAt, new Date()),
    )).limit(1);
    if (!record) return { found: false };
    const [location] = await db.select({ timezone: locations.timezone }).from(locations).where(and(
      eq(locations.tenantId, context.tenantId), eq(locations.id, context.locationId), eq(locations.active, true),
    )).limit(1);
    if (!location) throw new NotFoundException('Public booking page not found');
    return { found: true, booking: await this.fetchSummary(context.tenantId, record.bookingId), timezone: location.timezone };
  }

  async requestLink(slug: string, body: GuestAccessRequest, request: Request): Promise<{ accepted: true }> {
    const email = this.normalizeEmail(body?.email);
    const context = await this.resolve(slug);
    await this.enforceRateLimit(request, 'request-link', 4, context.tenantId, email);
    const activeGuestKey = await this.platformSettings.activeGuestTokenKey();
    if (typeof body?.bookingId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.bookingId)) return { accepted: true };
    const [match] = await db.select({ bookingId: bookings.id })
      .from(bookings).innerJoin(customers, and(eq(customers.tenantId, bookings.tenantId), eq(customers.id, bookings.customerId)))
      .where(and(eq(bookings.tenantId, context.tenantId), eq(bookings.id, body.bookingId), eq(customers.emailNormalized, email))).limit(1);
    if (!match) return { accepted: true };
    const token = randomBytes(32).toString('base64url');
    const encryptedPayload = this.encryptDelivery(email, slug, token, activeGuestKey.keyId, activeGuestKey.key);
    await db.transaction(async (tx) => {
      const [clock] = await tx.select({ now: sql<Date>`now()` });
      const now = new Date(clock.now);
      await tx.update(guestAccessTokens).set({ revokedAt: now }).where(and(
        eq(guestAccessTokens.tenantId, context.tenantId), eq(guestAccessTokens.bookingId, match.bookingId),
        isNull(guestAccessTokens.revokedAt), isNull(guestAccessTokens.redeemedAt),
      ));
      await tx.update(guestAccessSessions).set({ revokedAt: now }).where(and(
        eq(guestAccessSessions.tenantId, context.tenantId), eq(guestAccessSessions.bookingId, match.bookingId), isNull(guestAccessSessions.revokedAt),
      ));
      const [created] = await tx.insert(guestAccessTokens).values({
        tenantId: context.tenantId, bookingId: match.bookingId, tokenHash: this.digest(token),
        expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
      }).returning({ id: guestAccessTokens.id });
      await tx.insert(outboxMessages).values({ tenantId: context.tenantId, eventType: 'guest_access.delivery.requested',
        payload: { bookingId: match.bookingId, tokenId: created.id, encryption: 'aes-256-gcm-v1', ...encryptedPayload } });
    });
    return { accepted: true };
  }

  async redeem(slug: string, body: GuestTokenRedemptionRequest, request: Request): Promise<GuestSessionResponse> {
    const context = await this.resolve(slug);
    await this.enforceRateLimit(request, 'redeem', 10, context.tenantId);
    const token = typeof body?.token === 'string' ? body.token : '';
    if (!BASE64URL_TOKEN.test(token)) throw new UnauthorizedException('Guest access token is invalid or expired');
    const tokenHash = this.digest(token);
    const result = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(guestAccessTokens).where(and(
        eq(guestAccessTokens.tenantId, context.tenantId), eq(guestAccessTokens.tokenHash, tokenHash),
        eq(guestAccessTokens.scope, 'booking:manage'), isNull(guestAccessTokens.redeemedAt),
        isNull(guestAccessTokens.revokedAt), gt(guestAccessTokens.expiresAt, new Date()),
      )).for('update').limit(1);
      if (!row) return undefined;
      const [clock] = await tx.select({ now: sql<Date>`now()` });
      const now = new Date(clock.now);
      const updated = await tx.update(guestAccessTokens).set({ redeemedAt: now }).where(and(
        eq(guestAccessTokens.id, row.id), isNull(guestAccessTokens.redeemedAt), isNull(guestAccessTokens.revokedAt), gt(guestAccessTokens.expiresAt, now),
      )).returning({ id: guestAccessTokens.id });
      if (!updated.length) return undefined;
      const sessionToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
      await tx.insert(guestAccessSessions).values({
        tenantId: row.tenantId, bookingId: row.bookingId, tokenId: row.id,
        sessionHash: this.digest(sessionToken), expiresAt,
      });
      return { sessionToken, expiresAt, bookingId: row.bookingId };
    });
    if (!result) throw new UnauthorizedException('Guest access token is invalid or expired');
    return { accessToken: result.sessionToken, bookingId: result.bookingId, expiresAt: result.expiresAt.toISOString() };
  }

  private async authorizeSession(slug: string, bookingId: string, authorization: string | undefined, request: Request): Promise<GuestSession> {
    const context = await this.resolve(slug);
    await this.enforceRateLimit(request, 'manage', 30, context.tenantId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bookingId ?? '')) throw new UnauthorizedException('Guest session is invalid or expired');
    const match = authorization?.match(/^Guest ([A-Za-z0-9_-]{43})$/);
    if (!match) throw new UnauthorizedException('A guest session is required');
    const [session] = await db.select({ id: guestAccessSessions.id, tenantId: guestAccessSessions.tenantId, bookingId: guestAccessSessions.bookingId })
      .from(guestAccessSessions).innerJoin(guestAccessTokens, and(
        eq(guestAccessTokens.tenantId, guestAccessSessions.tenantId), eq(guestAccessTokens.bookingId, guestAccessSessions.bookingId), eq(guestAccessTokens.id, guestAccessSessions.tokenId),
      )).where(and(
        eq(guestAccessSessions.tenantId, context.tenantId), eq(guestAccessSessions.bookingId, bookingId),
        eq(guestAccessSessions.sessionHash, this.digest(match[1])), eq(guestAccessSessions.scope, 'booking:manage'),
        isNull(guestAccessSessions.revokedAt), gt(guestAccessSessions.expiresAt, new Date()),
        isNull(guestAccessTokens.revokedAt),
      )).limit(1);
    if (!session) throw new UnauthorizedException('Guest session is invalid or expired');
    return session;
  }

  private async fetchSummary(tenantId: string, bookingId: string): Promise<PublicBookingSummary> {
    const [row] = await db.select({ booking: bookings, allocation: bookingAllocations })
      .from(bookings).innerJoin(bookingAllocations, and(
        eq(bookingAllocations.tenantId, bookings.tenantId), eq(bookingAllocations.bookingId, bookings.id), eq(bookingAllocations.isCurrent, true),
      )).where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId))).limit(1);
    if (!row) throw new NotFoundException('Booking not found');
    const allocations = await db.select().from(bookingAllocations).where(and(eq(bookingAllocations.tenantId, tenantId), eq(bookingAllocations.bookingId, bookingId), eq(bookingAllocations.isCurrent, true))).orderBy(asc(bookingAllocations.segmentIndex));
    const segments = row.booking.serviceSnapshot.services ?? [{ id: row.booking.serviceId, name: row.booking.serviceSnapshot.name, durationMinutes: row.booking.serviceSnapshot.durationMinutes, priceMinor: row.booking.serviceSnapshot.priceMinor }];
    return this.publicSummary({ id: row.booking.id, serviceId: row.booking.serviceId, staffId: allocations[0]?.staffId ?? row.allocation.staffId,
      serviceAssignments: segments.map((segment: any, segmentIndex: number) => ({ serviceId: segment.id, staffId: segment.staffId ?? allocations[segmentIndex]?.staffId ?? row.allocation.staffId, startsAt: segment.startsAt ?? row.booking.startsAt.toISOString(), endsAt: new Date(Date.parse(segment.startsAt ?? row.booking.startsAt.toISOString()) + segment.durationMinutes * 60_000).toISOString(), segmentIndex })),
      startsAt: row.booking.startsAt.toISOString(), endsAt: row.booking.endsAt.toISOString(), status: row.booking.status,
      serviceSnapshot: row.booking.serviceSnapshot, version: row.booking.version } as BookingDto);
  }

  private publicSummary(booking: BookingDto): PublicBookingSummary {
    return { id: booking.id, serviceId: booking.serviceId, customerNote: booking.customerNote ?? null, staffId: booking.staffId, serviceAssignments: booking.serviceAssignments,
      startsAt: booking.startsAt, endsAt: booking.endsAt, status: booking.status,
      serviceName: booking.serviceSnapshot.name, version: booking.version };
  }

  async manage(slug: string, bookingId: string, authorization: string | undefined, request: Request): Promise<PublicBookingSummary> {
    const session = await this.authorizeSession(slug, bookingId, authorization, request);
    return this.fetchSummary(session.tenantId, session.bookingId);
  }

  async cancel(slug: string, bookingId: string, authorization: string | undefined, key: string | undefined, request: Request): Promise<PublicBookingSummary> {
    const session = await this.authorizeSession(slug, bookingId, authorization, request);
    const booking = await this.bookingsService.cancel(session.tenantId, session.id, key, session.bookingId, 'guest');
    return this.publicSummary(booking);
  }

  async reschedule(slug: string, bookingId: string, authorization: string | undefined, key: string | undefined, body: GuestRescheduleRequest, request: Request): Promise<PublicBookingSummary> {
    const session = await this.authorizeSession(slug, bookingId, authorization, request);
    const context = await this.resolve(slug);
    const booking = await this.bookingsService.reschedule(session.tenantId, context.locationId, session.id, key, session.bookingId, body, 'guest');
    return this.publicSummary(booking);
  }
}
