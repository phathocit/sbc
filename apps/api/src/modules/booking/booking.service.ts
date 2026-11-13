import { createHash } from 'node:crypto';
import {
  BadRequestException, ConflictException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import type {
  AvailabilitySlotDto, BookingCountPointDto, BookingDto, BookingRevenuePointDto, BookingScheduleSuggestionDto, BookingStatus, CreateBookingRequest, ServiceBookingCountDto,
  RescheduleBookingRequest, StaffSelection,
} from '@sbc/contracts';
import {
  and, asc, desc, eq, gt, gte, inArray, lt, lte, ne, or, sql,
} from 'drizzle-orm';
import {
  bookingAllocations, bookingEvents, bookings, businessHours, customers,
  guestAccessTokens, idempotencyRecords, locations, outboxMessages, scheduleExceptions,
  services, staffHours, staffProfiles, staffServices, tenantPolicies, tenants,
} from '../../../../../packages/database/dist/schema/index.js';
import { db } from '../../database';
import { BillingService } from '../billing/billing.service';
import { publishTenantNotification } from '../tenant-notifications/tenant-notifications.service';
import {
  formatLocalDate, formatLocalTime, localDateTimeToInstants, localDayBounds, nextLocalDate,
  parseLocalDate, resolveLocalBoundary,
} from './local-time';

type Segment = { start: number; end: number };
type AvailabilityOptions = {
  excludeBookingId?: string;
  now?: Date;
  serviceSnapshot?: BookingDto['serviceSnapshot'];
  requirePublished?: boolean;
  serviceIds?: string[];
};

export type PublicBookingCredential = {
  tokenHash?: string;
  expiresAt?: Date;
  encryptedPayload?: Record<string, string>;
};

function timeMinute(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function mergeSegments(input: Segment[]): Segment[] {
  const sorted = [...input].sort((a, b) => a.start - b.start || a.end - b.end);
  const result: Segment[] = [];
  for (const segment of sorted) {
    const last = result[result.length - 1];
    if (last && segment.start <= last.end) last.end = Math.max(last.end, segment.end);
    else result.push({ ...segment });
  }
  return result;
}

function applyExceptions(base: Segment[], exceptions: Array<{ localStart: string; localEnd: string; kind: string }>): Segment[] {
  let open = mergeSegments([
    ...base,
    ...exceptions.filter((item) => item.kind === 'available').map((item) => ({ start: timeMinute(item.localStart), end: timeMinute(item.localEnd) })),
  ]);
  for (const closed of exceptions.filter((item) => item.kind === 'unavailable')) {
    const blocked = { start: timeMinute(closed.localStart), end: timeMinute(closed.localEnd) };
    open = open.flatMap((segment) => {
      if (blocked.end <= segment.start || blocked.start >= segment.end) return [segment];
      const pieces: Segment[] = [];
      if (blocked.start > segment.start) pieces.push({ start: segment.start, end: Math.min(blocked.start, segment.end) });
      if (blocked.end < segment.end) pieces.push({ start: Math.max(blocked.end, segment.start), end: segment.end });
      return pieces;
    });
  }
  return mergeSegments(open);
}

function intersectSegments(left: Segment[], right: Segment[]): Segment[] {
  const result: Segment[] = [];
  for (const a of left) for (const b of right) {
    const start = Math.max(a.start, b.start);
    const end = Math.min(a.end, b.end);
    if (start < end) result.push({ start, end });
  }
  return mergeSegments(result);
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

@Injectable()
export class BookingService {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}
  private assertUuid(value: string, field: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? '')) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }

  private validateIdempotencyKey(key: string | undefined): string {
    const value = key?.trim();
    if (!value || value.length > 255) throw new BadRequestException('Idempotency-Key header is required and must be at most 255 characters');
    return value;
  }

  private async databaseNow(tx: any, tenantId: string): Promise<Date> {
    const [row] = await tx.select({ now: sql<Date>`now()` }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!row) throw new NotFoundException('Tenant not found');
    return new Date(row.now);
  }

  private async appendEvent(tx: any, tenantId: string, bookingId: string, actorType: string, actorId: string | null, eventType: string, summary: Record<string, unknown> = {}): Promise<void> {
    await tx.insert(bookingEvents).values({ tenantId, bookingId, actorType, actorId, eventType, summary });
    await tx.insert(outboxMessages).values({
      tenantId,
      eventType,
      // Only an internal reference is persisted here; customer details and credentials never enter the outbox.
      payload: { bookingId },
    });
    const notice = eventType === 'booking.created' && actorType === 'guest'
      ? summary.status === 'PENDING'
        ? ['booking_created', 'Lịch mới chờ duyệt', 'Khách vừa gửi một lịch đặt cần tiệm xác nhận.']
        : ['booking_created', 'Có lịch đặt mới', 'Khách vừa đặt một lịch đã được xác nhận.']
      : eventType === 'booking.cancelled' && actorType === 'guest'
        ? ['booking_cancelled', 'Khách đã hủy lịch', 'Một lịch đặt đã được khách hủy.']
        : eventType === 'booking.rescheduled' && actorType === 'guest'
          ? ['booking_rescheduled', 'Khách đã đổi lịch', 'Một lịch đặt đã được khách đổi thời gian.']
          : eventType === 'booking.expired'
            ? ['booking_expired', 'Lịch chờ duyệt đã hết hạn', 'Một lịch chờ duyệt đã hết hạn.']
            : null;
    if (notice) {
      const [target] = await tx.select({ startsAt: bookings.startsAt, timezone: locations.timezone, serviceSnapshot: bookings.serviceSnapshot, status: bookings.status })
        .from(bookings).innerJoin(locations, eq(locations.id, bookings.locationId))
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId))).limit(1);
      const dateParts = target ? Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: target.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(target.startsAt).map((part) => [part.type, part.value])) : null;
      const date = dateParts ? `${dateParts.year}-${dateParts.month}-${dateParts.day}` : '';
      const actionPath = `/workspace/calendar?view=day${date ? `&date=${date}` : ''}&bookingId=${encodeURIComponent(bookingId)}`;
      const serviceRows = target?.serviceSnapshot.services?.slice(0, 3) ?? [];
      const previousStartsAt = (summary.from as { startsAt?: unknown } | undefined)?.startsAt;
      await publishTenantNotification(tx, tenantId, notice[0], notice[1], notice[2], actionPath, {
        kind: 'booking',
        status: typeof summary.status === 'string' ? summary.status : target?.status ?? '',
        startsAt: target?.startsAt.toISOString() ?? '',
        ...(typeof previousStartsAt === 'string' ? { previousStartsAt } : {}),
        timezone: target?.timezone ?? 'Asia/Ho_Chi_Minh',
        services: serviceRows.map((service) => ({ name: service.name, ...(service.startsAt ? { startsAt: service.startsAt } : {}) })),
      });
    }
  }

  private async expirePending(tx: any, tenantId: string, now: Date): Promise<void> {
    const expired = await tx.select().from(bookings).where(and(
      eq(bookings.tenantId, tenantId), eq(bookings.status, 'PENDING'), lte(bookings.pendingExpiresAt, now),
    )).orderBy(asc(bookings.id)).for('update');
    for (const booking of expired) {
      await tx.update(bookings).set({ status: 'EXPIRED', pendingExpiresAt: null, version: sql`${bookings.version} + 1`, updatedAt: now })
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, booking.id), eq(bookings.status, 'PENDING')));
      await tx.update(bookingAllocations).set({ active: false })
        .where(and(eq(bookingAllocations.tenantId, tenantId), eq(bookingAllocations.bookingId, booking.id), eq(bookingAllocations.active, true)));
      await this.appendEvent(tx, tenantId, booking.id, 'system', null, 'booking.expired', { from: 'PENDING', to: 'EXPIRED' });
    }
  }

  private async runIdempotent(
    tenantId: string,
    actorId: string,
    operation: string,
    key: string,
    hash: string,
    action: (tx: any, now: Date) => Promise<string>,
  ): Promise<string> {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${actorId}:${operation}:${key}`}, 0))`);
        const now = await this.databaseNow(tx, tenantId);
        const [previous] = await tx.select().from(idempotencyRecords).where(and(
          eq(idempotencyRecords.tenantId, tenantId), eq(idempotencyRecords.actorId, actorId),
          eq(idempotencyRecords.operation, operation), eq(idempotencyRecords.key, key),
        )).for('update').limit(1);
        if (previous) {
          if (previous.requestHash !== hash) throw new ConflictException({ errorCode: 'IDEMPOTENCY_KEY_REUSED', message: 'This idempotency key was already used with a different request' });
          if (previous.expiresAt <= now) throw new ConflictException({ errorCode: 'IDEMPOTENCY_KEY_EXPIRED', message: 'This idempotency key has expired; use a new key' });
          await this.expirePending(tx, tenantId, now);
          return previous.resultBookingId;
        }
        await this.expirePending(tx, tenantId, now);
        const bookingId = await action(tx, now);
        await tx.insert(idempotencyRecords).values({
          tenantId, actorId, operation, key, requestHash: hash, resultBookingId: bookingId,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        });
        return bookingId;
      });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === '23P01') throw new ConflictException({ errorCode: 'SLOT_CONFLICT', message: 'The requested staff time is no longer available' });
      throw error;
    }
  }

  private validateEmail(value: string | undefined, required = true): string | null {
    const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!email && !required) return null;
    if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('A valid customer email is required');
    return email;
  }

  private validatePhone(value: string | undefined, required = false): string | null {
    const phone = typeof value === 'string' ? value.replace(/[\s().-]/g, '') : '';
    if (!phone && !required) return null;
    if (!/^\+?[0-9]{9,15}$/.test(phone)) throw new BadRequestException('A valid customer phone number is required');
    return phone;
  }

  private validateCustomerName(value: string): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name || name.length > 255) throw new BadRequestException('Customer name is required and must be at most 255 characters');
    return name;
  }

  private validateSelection(selection: StaffSelection, staffId?: string): void {
    if (!['SPECIFIC', 'ANY_AVAILABLE'].includes(selection)) throw new BadRequestException('staffSelection must be SPECIFIC or ANY_AVAILABLE');
    if (selection === 'SPECIFIC') {
      if (!staffId) throw new BadRequestException('staffId is required for SPECIFIC staff selection');
      this.assertUuid(staffId, 'staffId');
    } else if (staffId) throw new BadRequestException('staffId must be omitted for ANY_AVAILABLE selection');
  }

  private validateInstant(value: string): Date {
    if (typeof value !== 'string') throw new BadRequestException('startsAt must be an ISO timestamp');
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) throw new BadRequestException('startsAt must be a valid ISO timestamp');
    return instant;
  }

  private async buildAvailability(
    tenantId: string,
    locationId: string,
    serviceId: string,
    date: string,
    requestedStaffId?: string,
    options: AvailabilityOptions = {},
  ): Promise<AvailabilitySlotDto[]> {
    this.assertUuid(serviceId, 'serviceId');
    if (!parseLocalDate(date)) throw new BadRequestException('date must be a valid YYYY-MM-DD local date');
    if (requestedStaffId) this.assertUuid(requestedStaffId, 'staffId');

    const [location] = await db.select().from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId), eq(locations.active, true))).limit(1);
    if (!location) throw new NotFoundException('Active tenant location not found');
    const serviceFilters = [eq(services.tenantId, tenantId), eq(services.id, serviceId), eq(services.active, true)];
    if (options.requirePublished) serviceFilters.push(eq(services.published, true));
    const [service] = await db.select().from(services).where(and(...serviceFilters)).limit(1);
    if (!service) throw new NotFoundException('Active service not found in this tenant');
    const [policy] = await db.select().from(tenantPolicies).where(eq(tenantPolicies.tenantId, tenantId)).limit(1);
    if (!policy) throw new NotFoundException('Tenant booking policy not found');

    const now = options.now ?? new Date();
    const today = formatLocalDate(now, location.timezone);
    let lastDate = today;
    for (let i = 1; i < policy.bookingHorizonDays; i += 1) lastDate = nextLocalDate(lastDate);
    if (date < today || date > lastDate) return [];
    const durationMinutes = options.serviceSnapshot?.durationMinutes ?? service.durationMinutes;
    const bufferBeforeMinutes = options.serviceSnapshot?.bufferBeforeMinutes ?? service.bufferBeforeMinutes;
    const bufferAfterMinutes = options.serviceSnapshot?.bufferAfterMinutes ?? service.bufferAfterMinutes;
    const totalOccupied = bufferBeforeMinutes + durationMinutes + bufferAfterMinutes;
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || totalOccupied > 1440) throw new BadRequestException('Service duration and buffers must fit within one day');

    const serviceIds = options.serviceIds?.length ? options.serviceIds : [serviceId];
    const linksByService = await Promise.all(serviceIds.map((id) => db.select({ staffId: staffServices.staffId }).from(staffServices).where(and(eq(staffServices.tenantId, tenantId), eq(staffServices.serviceId, id)))));
    const eligibleSets = linksByService.map((links) => new Set(links.map((row) => row.staffId)));
    const eligibleIds = [...(eligibleSets[0] ?? new Set<string>())].filter((id) => eligibleSets.every((set) => set.has(id)));
    const staffRows = eligibleIds.length ? await db.select().from(staffProfiles).where(and(
      eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.locationId, locationId), eq(staffProfiles.active, true), inArray(staffProfiles.id, eligibleIds),
    )).orderBy(asc(staffProfiles.id)) : [];
    if (requestedStaffId && !staffRows.some((row) => row.id === requestedStaffId)) throw new BadRequestException('Selected staff member is not active or eligible for this service');
    const candidates = requestedStaffId ? staffRows.filter((row) => row.id === requestedStaffId) : staffRows;
    if (!candidates.length) return [];

    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const [locationHours, staffWorkingHours, dayExceptions, allocations] = await Promise.all([
      db.select().from(businessHours).where(and(eq(businessHours.tenantId, tenantId), eq(businessHours.locationId, locationId), eq(businessHours.weekday, weekday))),
      db.select().from(staffHours).where(and(eq(staffHours.tenantId, tenantId), inArray(staffHours.staffId, candidates.map((row) => row.id)), eq(staffHours.weekday, weekday))),
      db.select().from(scheduleExceptions).where(and(eq(scheduleExceptions.tenantId, tenantId), eq(scheduleExceptions.onDate, date), eq(scheduleExceptions.active, true), or(eq(scheduleExceptions.locationId, locationId), inArray(scheduleExceptions.staffId, candidates.map((row) => row.id))))),
      this.dayAllocations(tenantId, candidates.map((row) => row.id), date, location.timezone, options.excludeBookingId),
    ]);

    const locationExceptions = dayExceptions.filter((row) => row.scope === 'location');
    const locationWindows = applyExceptions(locationHours.map((row) => ({ start: timeMinute(row.localStart), end: timeMinute(row.localEnd) })), locationExceptions);
    if (!locationWindows.length) return [];

    const slotMap = new Map<string, { startsAt: string; localStart: string; timezone: string; staffIds: Set<string>; offset: string }>();
    for (const staff of candidates) {
      const ownHours = staffWorkingHours.filter((row) => row.staffId === staff.id);
      const ownExceptions = dayExceptions.filter((row) => row.scope === 'staff' && row.staffId === staff.id);
      const staffWindows = applyExceptions(ownHours.map((row) => ({ start: timeMinute(row.localStart), end: timeMinute(row.localEnd) })), ownExceptions);
      const windows = intersectSegments(locationWindows, staffWindows);
      const ownBusy = dayAllocationsForStaff(allocations, staff.id);
      for (const window of windows) {
        const windowStart = resolveLocalBoundary(date, window.start, location.timezone, 'start');
        const windowEnd = resolveLocalBoundary(date, window.end, location.timezone, 'end');
        if (!windowStart || !windowEnd) continue;
        const firstSlot = Math.ceil(window.start / policy.slotIntervalMinutes) * policy.slotIntervalMinutes;
        for (let localMinute = firstSlot; localMinute + totalOccupied <= window.end; localMinute += policy.slotIntervalMinutes) {
          for (const instant of localDateTimeToInstants(date, localMinute, location.timezone)) {
            const occupiedStart = new Date(instant.getTime() - bufferBeforeMinutes * 60_000);
            const occupiedEnd = new Date(instant.getTime() + (durationMinutes + bufferAfterMinutes) * 60_000);
            if (instant.getTime() <= now.getTime() + policy.minLeadMinutes * 60_000) continue;
            if (ownBusy.some((busy) => busy.start < occupiedEnd && busy.end > occupiedStart)) continue;
            if (occupiedStart < windowStart || occupiedEnd > windowEnd) continue;
            const iso = instant.toISOString();
            const local = formatLocalTime(instant, location.timezone);
            const id = `${iso}`;
            const slot = slotMap.get(id) ?? { startsAt: iso, localStart: local.time, timezone: location.timezone, staffIds: new Set<string>(), offset: local.offset };
            slot.staffIds.add(staff.id);
            slotMap.set(id, slot);
          }
        }
      }
    }
    return [...slotMap.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((slot) => ({
      startsAt: slot.startsAt,
      localStart: `${slot.localStart}${slot.offset && slot.offset !== 'GMT' && slot.offset !== 'GMT+0' ? ` (${slot.offset})` : ''}`,
      timezone: slot.timezone,
      staffIds: [...slot.staffIds].sort(),
    }));
  }

  private async dayAllocations(tenantId: string, staffIds: string[], date: string, timezone: string, excludeBookingId?: string): Promise<Array<{ staffId: string; start: Date; end: Date }>> {
    if (!staffIds.length) return [];
    const bounds = localDayBounds(date, timezone);
    if (!bounds) return [];
    const filters = [eq(bookingAllocations.tenantId, tenantId), eq(bookingAllocations.active, true), inArray(bookingAllocations.staffId, staffIds), lt(bookingAllocations.occupiedStart, bounds.end), gt(bookingAllocations.occupiedEnd, bounds.start)];
    if (excludeBookingId) filters.push(ne(bookingAllocations.bookingId, excludeBookingId));
    const rows = await db.select({ staffId: bookingAllocations.staffId, start: bookingAllocations.occupiedStart, end: bookingAllocations.occupiedEnd })
      .from(bookingAllocations).where(and(...filters));
    return rows;
  }

  async availability(tenantId: string, locationId: string, serviceId: string, date: string, staffId?: string, requirePublished = false, requestedServiceIds?: string[]): Promise<AvailabilitySlotDto[]> {
    const now = await db.transaction(async (tx) => {
      if (requirePublished) {
        const [tenant] = await tx.select().from(tenants).where(and(eq(tenants.id, tenantId), eq(tenants.status, 'active'))).for('share').limit(1);
        if (!tenant) throw new NotFoundException('Public booking page not found');
      }
      const current = await this.databaseNow(tx, tenantId);
      await this.expirePending(tx, tenantId, current);
      return current;
    });
    if (requestedServiceIds !== undefined && (!Array.isArray(requestedServiceIds) || requestedServiceIds.some((id) => typeof id !== 'string'))) throw new BadRequestException('serviceIds must be a list of service IDs');
    const serviceIds = requestedServiceIds?.length ? [...new Set(requestedServiceIds)] : [serviceId];
    if (serviceIds.length > 3 || serviceIds[0] !== serviceId || serviceIds.length !== (requestedServiceIds?.length ?? serviceIds.length)) throw new BadRequestException('serviceIds must contain 1 to 3 unique services, starting with serviceId');
    const serviceRows = await db.select().from(services).where(and(eq(services.tenantId, tenantId), inArray(services.id, serviceIds), eq(services.active, true), ...(requirePublished ? [eq(services.published, true)] : [])));
    if (serviceRows.length !== serviceIds.length) throw new NotFoundException('One or more selected services are unavailable');
    const selectedServices = serviceIds.map((id) => serviceRows.find((item) => item.id === id)!);
    if (selectedServices.some((item) => item.currency !== selectedServices[0].currency)) throw new BadRequestException('Selected services must use the same currency');
    const first = selectedServices[0];
    const last = selectedServices.at(-1)!;
    const snapshot = { name: selectedServices.map((item) => item.name).join(' + '), durationMinutes: selectedServices.reduce((sum, item) => sum + item.durationMinutes, 0), bufferBeforeMinutes: first.bufferBeforeMinutes, bufferAfterMinutes: last.bufferAfterMinutes, priceMinor: selectedServices.reduce((sum, item) => sum + item.priceMinor, 0), currency: first.currency };
    return this.buildAvailability(tenantId, locationId, serviceId, date, staffId, { now, requirePublished, serviceIds, serviceSnapshot: snapshot });
  }

  async scheduleSuggestions(tenantId: string, locationId: string, serviceIds: string[], date: string, staffByService: Record<string, string | undefined> = {}, requirePublished = false): Promise<BookingScheduleSuggestionDto[]> {
    if (!parseLocalDate(date) || !Array.isArray(serviceIds) || serviceIds.length < 1 || serviceIds.length > 3 || new Set(serviceIds).size !== serviceIds.length) throw new BadRequestException('Select one to three unique services and a valid local date');
    serviceIds.forEach((id, index) => this.assertUuid(id, `serviceIds[${index}]`));
    const orderedServiceIds = [...serviceIds].sort();
    const [location] = await db.select().from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId), eq(locations.active, true))).limit(1);
    if (!location) throw new NotFoundException('Active tenant location not found');
    const serviceRows = await db.select().from(services).where(and(eq(services.tenantId, tenantId), inArray(services.id, serviceIds), eq(services.active, true), ...(requirePublished ? [eq(services.published, true)] : [])));
    if (serviceRows.length !== serviceIds.length) throw new NotFoundException('One or more selected services are unavailable');
    const byId = new Map(serviceRows.map((service) => [service.id, service]));
    const now = await db.transaction(async (tx) => {
      const current = await this.databaseNow(tx, tenantId);
      await this.expirePending(tx, tenantId, current);
      return current;
    });
    const slotRows = new Map<string, AvailabilitySlotDto[]>();
    for (const id of orderedServiceIds) {
      const requestedStaffId = staffByService[id] || undefined;
      if (requestedStaffId) this.assertUuid(requestedStaffId, `staffByService.${id}`);
      slotRows.set(id, await this.buildAvailability(tenantId, locationId, id, date, requestedStaffId, { now, requirePublished }));
    }
    const maxGap = 30 * 60_000;
    const suggestionsByStart = new Map<string, BookingScheduleSuggestionDto[]>();
    const subsets: string[][] = [];
    for (let mask = 1; mask < (1 << orderedServiceIds.length); mask += 1) subsets.push(orderedServiceIds.filter((_id, index) => mask & (1 << index)));
    subsets.sort((a, b) => b.length - a.length);
    for (const subset of subsets) {
      const permutations = (values: string[]): string[][] => values.length <= 1 ? [values] : values.flatMap((value, index) => permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((tail) => [value, ...tail]));
      for (const order of permutations(subset)) {
        const firstSlots = slotRows.get(order[0]) ?? [];
        for (const first of firstSlots) {
          const walk = (index: number, segments: BookingScheduleSuggestionDto['segments']) => {
            if (index === order.length) {
              const start = segments[0].startsAt;
              const displayTime = first.localStart.replace(/\s*\(GMT[^)]*\)$/i, '');
              const entry: BookingScheduleSuggestionDto = { startsAt: start, localStart: first.localStart, timezone: first.timezone, segments: segments.map((segment, segmentIndex) => ({ ...segment, segmentIndex })), omittedServiceIds: orderedServiceIds.filter((id) => !subset.includes(id)) };
              const existing = suggestionsByStart.get(displayTime) ?? [];
              const bestCount = existing[0]?.segments.length ?? 0;
              const sameServiceSet = (items: BookingScheduleSuggestionDto['segments']) => items.map((item) => item.serviceId).sort().join('|') === segments.map((item) => item.serviceId).sort().join('|');
              if (segments.length > bestCount) suggestionsByStart.set(displayTime, [entry]);
              else if (segments.length === bestCount && existing.length < 4 && !existing.some((item) => sameServiceSet(item.segments))) existing.push(entry);
              if (segments.length === bestCount) suggestionsByStart.set(displayTime, existing);
              return;
            }
            const previous = segments.at(-1)!;
            const previousService = byId.get(previous.serviceId)!;
            const previousEnd = Date.parse(previous.endsAt);
            const candidates = (slotRows.get(order[index]) ?? []).filter((slot) => Date.parse(slot.startsAt) >= previousEnd && Date.parse(slot.startsAt) <= previousEnd + maxGap);
            for (const slot of candidates) for (const staffId of slot.staffIds) {
              const service = byId.get(order[index])!;
              const occupiedStart = Date.parse(slot.startsAt) - service.bufferBeforeMinutes * 60_000;
              const occupiedEnd = Date.parse(slot.startsAt) + (service.durationMinutes + service.bufferAfterMinutes) * 60_000;
              const conflict = segments.some((segment) => segment.staffId === staffId && (() => {
                const priorService = byId.get(segment.serviceId)!;
                const priorStart = Date.parse(segment.startsAt) - priorService.bufferBeforeMinutes * 60_000;
                const priorEnd = Date.parse(segment.endsAt) + priorService.bufferAfterMinutes * 60_000;
                return priorStart < occupiedEnd && priorEnd > occupiedStart;
              })());
              if (conflict) continue;
              walk(index + 1, [...segments, { serviceId: service.id, staffId, startsAt: slot.startsAt, endsAt: new Date(Date.parse(slot.startsAt) + service.durationMinutes * 60_000).toISOString(), segmentIndex: index }]);
            }
          };
          const firstService = byId.get(order[0])!;
          for (const staffId of first.staffIds) walk(1, [{ serviceId: firstService.id, staffId, startsAt: first.startsAt, endsAt: new Date(Date.parse(first.startsAt) + firstService.durationMinutes * 60_000).toISOString(), segmentIndex: 0 }]);
        }
      }
    }
    return [...suggestionsByStart.values()].flat().sort((a, b) => b.segments.length - a.segments.length || a.startsAt.localeCompare(b.startsAt)).slice(0, 120);
  }

  private async lockBookingInputs(tx: any, tenantId: string, locationId: string, serviceId: string, requirePublished = false): Promise<{ location: any; service: any; policy: any }> {
    const [location] = await tx.select().from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId), eq(locations.active, true))).for('share').limit(1);
    if (!location) throw new NotFoundException('Active tenant location not found');
    const [policy] = await tx.select().from(tenantPolicies).where(eq(tenantPolicies.tenantId, tenantId)).for('share').limit(1);
    if (!policy) throw new NotFoundException('Tenant booking policy not found');
    const serviceFilters = [eq(services.tenantId, tenantId), eq(services.id, serviceId), eq(services.active, true)];
    if (requirePublished) serviceFilters.push(eq(services.published, true));
    const [service] = await tx.select().from(services).where(and(...serviceFilters)).for('share').limit(1);
    if (!service) throw new NotFoundException('Active service not found in this tenant');
    return { location, service, policy };
  }

  private async lockEligibleStaff(tx: any, tenantId: string, locationId: string, serviceId: string, additionalIds: string[] = []): Promise<void> {
    const links = await tx.select({ staffId: staffServices.staffId }).from(staffServices).where(and(eq(staffServices.tenantId, tenantId), eq(staffServices.serviceId, serviceId)));
    const ids = [...new Set([...links.map((row: { staffId: string }) => row.staffId), ...additionalIds])].sort();
    if (!ids.length) return;
    await tx.select({ id: staffProfiles.id }).from(staffProfiles).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.locationId, locationId), inArray(staffProfiles.id, ids))).orderBy(asc(staffProfiles.id)).for('update');
  }

  private async rankStaff(tenantId: string, slots: AvailabilitySlotDto[], startsAt: Date, selection: StaffSelection, requestedStaffId?: string): Promise<string[]> {
    const slot = slots.find((item) => item.startsAt === startsAt.toISOString());
    if (!slot) throw new ConflictException({ errorCode: 'SLOT_CONFLICT', message: 'The requested start time is not available for this service' });
    if (selection === 'SPECIFIC') {
      if (!requestedStaffId || !slot.staffIds.includes(requestedStaffId)) throw new ConflictException({ errorCode: 'STAFF_UNAVAILABLE', message: 'The selected staff member is not available at this time' });
      return [requestedStaffId];
    }
    if (!slot.staffIds.length) throw new ConflictException({ errorCode: 'STAFF_UNAVAILABLE', message: 'No eligible staff member is available at this time' });
    const counts = await db.select({ staffId: bookingAllocations.staffId }).from(bookingAllocations).where(and(
      eq(bookingAllocations.active, true), eq(bookingAllocations.tenantId, tenantId),
      inArray(bookingAllocations.staffId, slot.staffIds),
      lt(bookingAllocations.occupiedStart, new Date(startsAt.getTime() + 36 * 60 * 60 * 1000)),
      gt(bookingAllocations.occupiedEnd, new Date(startsAt.getTime() - 36 * 60 * 60 * 1000)),
    ));
    const workload = new Map<string, number>();
    for (const row of counts) workload.set(row.staffId, (workload.get(row.staffId) ?? 0) + 1);
    return [...slot.staffIds].sort((a, b) => (workload.get(a) ?? 0) - (workload.get(b) ?? 0) || a.localeCompare(b));
  }

  private async insertAllocationWithRetry(tx: any, tenantId: string, bookingId: string, staffIds: string[], startsAt: Date, service: any, selection: StaffSelection, segmentIndex = 0): Promise<string> {
    const candidates = selection === 'ANY_AVAILABLE' ? staffIds.slice(0, 32) : staffIds.slice(0, 1);
    for (const staffId of candidates) {
      try {
        await tx.transaction(async (savepoint: any) => {
          await savepoint.insert(bookingAllocations).values({
            tenantId, bookingId, staffId, segmentIndex,
            occupiedStart: new Date(startsAt.getTime() - service.bufferBeforeMinutes * 60_000),
            occupiedEnd: new Date(startsAt.getTime() + (service.durationMinutes + service.bufferAfterMinutes) * 60_000),
            active: true, isCurrent: true,
          });
        });
        return staffId;
      } catch (error) {
        if ((error as { code?: string })?.code === '23P01' && selection === 'ANY_AVAILABLE') continue;
        throw error;
      }
    }
    throw new ConflictException({ errorCode: 'SLOT_CONFLICT', message: 'No eligible staff member could be allocated to this time' });
  }

  async createBooking(tenantId: string, locationId: string, actorId: string, key: string | undefined, dto: CreateBookingRequest, guestCredential?: PublicBookingCredential): Promise<BookingDto> {
    if (!dto || typeof dto !== 'object') throw new BadRequestException('A booking request body is required');
    if (dto.serviceIds !== undefined && (!Array.isArray(dto.serviceIds) || dto.serviceIds.some((id) => typeof id !== 'string'))) throw new BadRequestException('serviceIds must be a list of service IDs');
    const serviceIds = dto.serviceIds?.length ? dto.serviceIds : [dto.serviceId];
    if (serviceIds.length > 3 || new Set(serviceIds).size !== serviceIds.length || serviceIds[0] !== dto.serviceId) throw new BadRequestException('serviceIds must contain 1 to 3 unique services, starting with serviceId');
    serviceIds.forEach((id, index) => this.assertUuid(id, `serviceIds[${index}]`));
    this.validateSelection(dto.staffSelection, dto.staffId);
    const startsAt = this.validateInstant(dto.startsAt);
    const customerName = this.validateCustomerName(dto.customerName);
    const customerEmail = this.validateEmail(dto.customerEmail, !guestCredential);
    const customerPhone = this.validatePhone(dto.customerPhone, Boolean(guestCredential));
    const customerNote = typeof dto.customerNote === 'string' ? dto.customerNote.trim() : '';
    if (customerNote.length > 1000) throw new BadRequestException('customerNote must be at most 1000 characters');
    const idemKey = this.validateIdempotencyKey(key);
    const hash = requestHash({ ...dto, customerName, customerEmail });
    const bookingId = await this.runIdempotent(tenantId, actorId, 'booking.create', idemKey, hash, async (tx, now) => {
      if (guestCredential) {
        const [tenant] = await tx.select().from(tenants).where(and(eq(tenants.id, tenantId), eq(tenants.status, 'active'))).for('share').limit(1);
        if (!tenant) throw new NotFoundException('Public booking page not found');
      }
      const { location, service: firstService, policy } = await this.lockBookingInputs(tx, tenantId, locationId, dto.serviceId, Boolean(guestCredential));
      const selectedServiceRows = serviceIds.length === 1 ? [firstService] : await tx.select().from(services)
        .where(and(eq(services.tenantId, tenantId), inArray(services.id, serviceIds), eq(services.active, true), ...(guestCredential ? [eq(services.published, true)] : [])))
        .for('share');
      if (selectedServiceRows.length !== serviceIds.length) throw new NotFoundException('One or more selected services are unavailable');
      const selectedServices = serviceIds.map((id) => selectedServiceRows.find((item: any) => item.id === id)!);
      if (selectedServices.some((item: any) => item.currency !== firstService.currency)) throw new BadRequestException('Selected services must use the same currency');
      const service = {
        ...firstService,
        name: selectedServices.map((item: any) => item.name).join(' + '),
        durationMinutes: selectedServices.reduce((sum: number, item: any) => sum + item.durationMinutes, 0),
        priceMinor: selectedServices.reduce((sum: number, item: any) => sum + item.priceMinor, 0),
        bufferBeforeMinutes: selectedServices[0].bufferBeforeMinutes,
        bufferAfterMinutes: selectedServices.at(-1).bufferAfterMinutes,
      };
      const assignments = dto.serviceAssignments;
      if (serviceIds.length > 1 && (!Array.isArray(assignments) || assignments.length !== serviceIds.length)) throw new BadRequestException('Provide one schedule assignment for every selected service');
      let resolvedAssignments: Array<{ serviceId: string; staffId: string; startsAt: Date; service: any }> = [];
      if (serviceIds.length === 1 && !assignments?.length) {
        resolvedAssignments = [{ serviceId: serviceIds[0], staffId: '', startsAt, service: selectedServices[0] }];
      } else {
        if (!Array.isArray(assignments) || assignments.length !== serviceIds.length) throw new BadRequestException('Schedule assignments must cover every selected service exactly once');
        const seen = new Set<string>();
        resolvedAssignments = assignments.map((assignment, index) => {
          if (!assignment || typeof assignment !== 'object' || typeof assignment.serviceId !== 'string' || typeof assignment.staffId !== 'string' || typeof assignment.startsAt !== 'string') throw new BadRequestException(`serviceAssignments[${index}] is invalid`);
          if (!serviceIds.includes(assignment.serviceId) || seen.has(assignment.serviceId)) throw new BadRequestException('Schedule assignments contain duplicate or unselected services');
          seen.add(assignment.serviceId);
          this.assertUuid(assignment.staffId, `serviceAssignments[${index}].staffId`);
          const assignedService = selectedServices.find((item: any) => item.id === assignment.serviceId)!;
          return { serviceId: assignment.serviceId, staffId: assignment.staffId, startsAt: this.validateInstant(assignment.startsAt), service: assignedService };
        }).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
        if (resolvedAssignments[0].startsAt.getTime() !== startsAt.getTime()) throw new BadRequestException('The first service must start at the selected appointment time');
        for (let i = 1; i < resolvedAssignments.length; i += 1) {
          const previous = resolvedAssignments[i - 1];
          const gapMinutes = (resolvedAssignments[i].startsAt.getTime() - previous.startsAt.getTime() - previous.service.durationMinutes * 60_000) / 60_000;
          if (gapMinutes < 0 || gapMinutes > 30) throw new BadRequestException('Services must be sequential with no more than 30 minutes between them');
        }
      }
      await this.billing.reserveBookingQuota(tx, tenantId, now);
      for (const id of [...serviceIds].sort()) await this.lockEligibleStaff(tx, tenantId, locationId, id);
      const slots = serviceIds.length === 1 ? await this.buildAvailability(tenantId, locationId, dto.serviceId, formatLocalDate(startsAt, location.timezone), dto.staffId, { now, requirePublished: Boolean(guestCredential) }) : [];
      const staffIds = serviceIds.length === 1 ? await this.rankStaff(tenantId, slots, startsAt, dto.staffSelection, dto.staffId) : [];
      const endsAt = new Date(resolvedAssignments.at(-1)!.startsAt.getTime() + resolvedAssignments.at(-1)!.service.durationMinutes * 60_000);
      const status: BookingStatus = policy.confirmationMode === 'AUTO' ? 'CONFIRMED' : 'PENDING';
      const pendingExpiresAt = status === 'PENDING'
        ? new Date(Math.min(now.getTime() + policy.pendingExpiryMinutes * 60_000, startsAt.getTime()))
        : null;
      const [customer] = await tx.insert(customers).values({ tenantId, displayName: customerName, emailNormalized: customerEmail, phoneNormalized: customerPhone }).returning();
      const [booking] = await tx.insert(bookings).values({
        tenantId, locationId: location.id, customerId: customer.id, serviceId: service.id, customerNote: customerNote || null,
        startsAt, endsAt, status, pendingExpiresAt,
        serviceSnapshot: {
          name: service.name, durationMinutes: service.durationMinutes,
          bufferBeforeMinutes: service.bufferBeforeMinutes, bufferAfterMinutes: service.bufferAfterMinutes,
          priceMinor: service.priceMinor, currency: service.currency,
          services: resolvedAssignments.map((item, segmentIndex) => ({ id: item.serviceId, name: item.service.name, durationMinutes: item.service.durationMinutes, priceMinor: item.service.priceMinor, staffId: item.staffId || null, startsAt: item.startsAt.toISOString(), segmentIndex })),
        },
        policySnapshot: {
          confirmationMode: policy.confirmationMode, pendingExpiryMinutes: policy.pendingExpiryMinutes,
          cancellationCutoffMinutes: policy.cancellationCutoffMinutes, rescheduleCutoffMinutes: policy.rescheduleCutoffMinutes,
          minLeadMinutes: policy.minLeadMinutes, bookingHorizonDays: policy.bookingHorizonDays,
          slotIntervalMinutes: policy.slotIntervalMinutes, version: policy.version,
        },
      }).returning();
      if (guestCredential?.tokenHash && guestCredential.expiresAt && guestCredential.encryptedPayload) {
        await tx.insert(guestAccessTokens).values({ tenantId, bookingId: booking.id, tokenHash: guestCredential.tokenHash, expiresAt: guestCredential.expiresAt });
        await tx.insert(outboxMessages).values({
          tenantId,
          eventType: 'guest_access.delivery.requested',
          payload: { bookingId: booking.id, encryption: 'aes-256-gcm-v1', ...guestCredential.encryptedPayload },
        });
      }
      let primaryStaffId = dto.staffId ?? '';
      for (let segmentIndex = 0; segmentIndex < resolvedAssignments.length; segmentIndex += 1) {
        const assignment = resolvedAssignments[segmentIndex];
        if (serviceIds.length === 1 && !assignments?.length) {
          primaryStaffId = await this.insertAllocationWithRetry(tx, tenantId, booking.id, staffIds, startsAt, assignment.service, dto.staffSelection, segmentIndex);
          continue;
        }
        const available = await this.buildAvailability(tenantId, location.id, assignment.serviceId, formatLocalDate(assignment.startsAt, location.timezone), assignment.staffId || undefined, { now, requirePublished: Boolean(guestCredential) });
        const candidateIds = await this.rankStaff(tenantId, available, assignment.startsAt, assignment.staffId ? 'SPECIFIC' : 'ANY_AVAILABLE', assignment.staffId || undefined);
        const allocated = await this.insertAllocationWithRetry(tx, tenantId, booking.id, candidateIds, assignment.startsAt, assignment.service, assignment.staffId ? 'SPECIFIC' : 'ANY_AVAILABLE', segmentIndex);
        if (segmentIndex === 0) primaryStaffId = allocated;
      }
      await this.appendEvent(tx, tenantId, booking.id, guestCredential ? 'guest' : 'business', actorId, 'booking.created', { status, serviceId: service.id, serviceIds, staffId: primaryStaffId, startsAt: startsAt.toISOString() });
      return booking.id;
    });
    return this.getBooking(tenantId, bookingId);
  }

  private async getBooking(tenantId: string, bookingId: string): Promise<BookingDto> {
    const [row] = await db.select({ booking: bookings, customer: customers })
      .from(bookings).innerJoin(customers, and(eq(bookings.tenantId, customers.tenantId), eq(bookings.customerId, customers.id)))
      .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId))).limit(1);
    if (!row) throw new NotFoundException('Booking not found in this tenant');
    const allocations = await db.select().from(bookingAllocations).where(and(eq(bookingAllocations.tenantId, tenantId), eq(bookingAllocations.bookingId, bookingId), eq(bookingAllocations.isCurrent, true))).orderBy(asc(bookingAllocations.segmentIndex));
    if (!allocations.length) throw new NotFoundException('Booking allocation not found');
    const booking = row.booking;
    const snapshotSegments = booking.serviceSnapshot.services?.length ? booking.serviceSnapshot.services : [{ id: booking.serviceId, name: booking.serviceSnapshot.name, durationMinutes: booking.serviceSnapshot.durationMinutes, priceMinor: booking.serviceSnapshot.priceMinor }];
    return {
      id: booking.id, tenantId: booking.tenantId, locationId: booking.locationId, customerId: booking.customerId,
      customerName: row.customer.displayName, customerEmail: row.customer.emailNormalized, customerPhone: row.customer.phoneNormalized, customerNote: booking.customerNote,
      serviceId: booking.serviceId, staffId: allocations[0].staffId,
      serviceAssignments: snapshotSegments.map((segment, segmentIndex) => ({ serviceId: segment.id, staffId: segment.staffId ?? allocations[segmentIndex]?.staffId ?? allocations[0].staffId, startsAt: segment.startsAt ?? booking.startsAt.toISOString(), endsAt: new Date(Date.parse(segment.startsAt ?? booking.startsAt.toISOString()) + segment.durationMinutes * 60_000).toISOString(), segmentIndex })),
      startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString(), status: booking.status as BookingStatus,
      pendingExpiresAt: booking.pendingExpiresAt?.toISOString() ?? null,
      serviceSnapshot: booking.serviceSnapshot, policySnapshot: booking.policySnapshot,
      version: booking.version, createdAt: booking.createdAt.toISOString(), updatedAt: booking.updatedAt.toISOString(),
    };
  }

  async listBookings(tenantId: string, limit = 100, from?: Date, to?: Date): Promise<BookingDto[]> {
    if (Boolean(from) !== Boolean(to)) throw new BadRequestException('Both from and to are required for a booking date range');
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from >= to)) throw new BadRequestException('A valid non-empty booking date range is required');
    if (from && to && to.getTime() - from.getTime() > 31 * 24 * 60 * 60_000) throw new BadRequestException('Booking date range must not exceed 31 days');
    const safeLimit = Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : 100;
    const ids = await db.transaction(async (tx) => {
      const now = await this.databaseNow(tx, tenantId);
      await this.expirePending(tx, tenantId, now);
      const filters = [eq(bookings.tenantId, tenantId)];
      if (from) filters.push(gte(bookings.startsAt, from));
      if (to) filters.push(lt(bookings.startsAt, to));
      const rows = await tx.select({ id: bookings.id }).from(bookings).where(and(...filters)).orderBy(desc(bookings.startsAt)).limit(safeLimit);
      return rows.map((row: { id: string }) => row.id);
    });
    return Promise.all(ids.map((id) => this.getBooking(tenantId, id)));
  }

  async bookingCounts(tenantId: string, locationId: string, fromDate: string, toDate: string): Promise<BookingCountPointDto[]> {
    if (!parseLocalDate(fromDate) || !parseLocalDate(toDate) || fromDate > toDate) {
      throw new BadRequestException('A valid inclusive local date range is required');
    }
    const fromDay = new Date(`${fromDate}T00:00:00.000Z`);
    const toDay = new Date(`${toDate}T00:00:00.000Z`);
    const dayCount = Math.floor((toDay.getTime() - fromDay.getTime()) / 86_400_000) + 1;
    if (dayCount > 366) throw new BadRequestException('Booking analytics date range must not exceed 366 days');

    const [location] = await db.select({ timezone: locations.timezone }).from(locations).where(and(
      eq(locations.tenantId, tenantId), eq(locations.id, locationId), eq(locations.active, true),
    )).limit(1);
    if (!location) throw new NotFoundException('Active tenant location not found');
    const start = localDayBounds(fromDate, location.timezone);
    const end = localDayBounds(toDate, location.timezone);
    if (!start || !end) throw new BadRequestException('Could not resolve the requested local date range');

    const datedBookings = db.select({
      date: sql<string>`to_char(${bookings.startsAt} at time zone ${location.timezone}, 'YYYY-MM-DD')`.as('local_date'),
    }).from(bookings)
      .where(and(
        eq(bookings.tenantId, tenantId), eq(bookings.locationId, locationId),
        gte(bookings.startsAt, start.start), lt(bookings.startsAt, end.end),
      ))
      .as('dated_bookings');
    const rows = await db.select({ date: datedBookings.date, count: sql<number>`count(*)::int` })
      .from(datedBookings)
      .groupBy(datedBookings.date)
      .orderBy(asc(datedBookings.date));
    return rows.map((row) => ({ date: row.date, count: Number(row.count) }));
  }

  async serviceBookingCounts(tenantId: string, locationId: string, fromDate: string, toDate: string): Promise<ServiceBookingCountDto[]> {
    if (!parseLocalDate(fromDate) || !parseLocalDate(toDate) || fromDate > toDate) {
      throw new BadRequestException('A valid inclusive local date range is required');
    }
    const fromDay = new Date(`${fromDate}T00:00:00.000Z`);
    const toDay = new Date(`${toDate}T00:00:00.000Z`);
    const dayCount = Math.floor((toDay.getTime() - fromDay.getTime()) / 86_400_000) + 1;
    if (dayCount > 366) throw new BadRequestException('Booking analytics date range must not exceed 366 days');

    const [location] = await db.select({ timezone: locations.timezone }).from(locations).where(and(
      eq(locations.tenantId, tenantId), eq(locations.id, locationId), eq(locations.active, true),
    )).limit(1);
    if (!location) throw new NotFoundException('Active tenant location not found');
    const start = localDayBounds(fromDate, location.timezone);
    const end = localDayBounds(toDate, location.timezone);
    if (!start || !end) throw new BadRequestException('Could not resolve the requested local date range');

    const rows = await db.select({ serviceId: bookings.serviceId, serviceSnapshot: bookings.serviceSnapshot })
      .from(bookings)
      .where(and(
        eq(bookings.tenantId, tenantId), eq(bookings.locationId, locationId),
        gte(bookings.startsAt, start.start), lt(bookings.startsAt, end.end),
      ));
    const counts = new Map<string, { serviceId: string; serviceName: string; count: number }>();
    for (const booking of rows) {
      const snapshot = booking.serviceSnapshot as BookingDto['serviceSnapshot'];
      const snapshotServices = Array.isArray(snapshot.services) && snapshot.services.length
        ? snapshot.services
        : [{ id: booking.serviceId, name: snapshot.name, durationMinutes: snapshot.durationMinutes, priceMinor: snapshot.priceMinor }];
      for (const service of snapshotServices) {
        const key = `${service.id}\0${service.name}`;
        const current = counts.get(key);
        if (current) current.count += 1;
        else counts.set(key, { serviceId: service.id, serviceName: service.name, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.serviceName.localeCompare(b.serviceName, 'vi'));
  }

  async bookingRevenue(tenantId: string, locationId: string, fromDate: string, toDate: string): Promise<BookingRevenuePointDto[]> {
    if (!parseLocalDate(fromDate) || !parseLocalDate(toDate) || fromDate > toDate) {
      throw new BadRequestException('A valid inclusive local date range is required');
    }
    const fromDay = new Date(`${fromDate}T00:00:00.000Z`);
    const toDay = new Date(`${toDate}T00:00:00.000Z`);
    const dayCount = Math.floor((toDay.getTime() - fromDay.getTime()) / 86_400_000) + 1;
    if (dayCount > 366) throw new BadRequestException('Booking analytics date range must not exceed 366 days');

    const [location] = await db.select({ timezone: locations.timezone }).from(locations).where(and(
      eq(locations.tenantId, tenantId), eq(locations.id, locationId), eq(locations.active, true),
    )).limit(1);
    if (!location) throw new NotFoundException('Active tenant location not found');
    const start = localDayBounds(fromDate, location.timezone);
    const end = localDayBounds(toDate, location.timezone);
    if (!start || !end) throw new BadRequestException('Could not resolve the requested local date range');

    const datedBookings = db.select({
      date: sql<string>`to_char(${bookings.startsAt} at time zone ${location.timezone}, 'YYYY-MM-DD')`.as('local_date'),
      amountMinor: sql<number>`coalesce(nullif(${bookings.serviceSnapshot}->>'priceMinor', '')::numeric, 0)::float8`.as('amount_minor'),
    }).from(bookings).where(and(
      eq(bookings.tenantId, tenantId), eq(bookings.locationId, locationId),
      inArray(bookings.status, ['CONFIRMED', 'COMPLETED']),
      gte(bookings.startsAt, start.start), lt(bookings.startsAt, end.end),
    )).as('dated_bookings');
    const rows = await db.select({
      date: datedBookings.date,
      amountMinor: sql<number>`coalesce(sum(${datedBookings.amountMinor}), 0)::float8`.as('amount_minor'),
      bookingCount: sql<number>`count(*)::int`.as('booking_count'),
    }).from(datedBookings).groupBy(datedBookings.date).orderBy(datedBookings.date);

    return rows.map((row) => ({ date: row.date, amountMinor: Number(row.amountMinor), bookingCount: Number(row.bookingCount) }));
  }

  async approve(tenantId: string, actorId: string, key: string | undefined, bookingId: string): Promise<BookingDto> {
    this.assertUuid(bookingId, 'bookingId');
    const idemKey = this.validateIdempotencyKey(key);
    const id = await this.runIdempotent(tenantId, actorId, 'booking.approve', idemKey, requestHash({ bookingId }), async (tx, now) => {
      const [booking] = await tx.select().from(bookings).where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId))).for('update').limit(1);
      if (!booking) throw new NotFoundException('Booking not found in this tenant');
      if (booking.status === 'EXPIRED') throw new ConflictException({ errorCode: 'BOOKING_EXPIRED', message: 'Pending booking has expired' });
      if (booking.status !== 'PENDING') throw new ConflictException({ errorCode: 'INVALID_TRANSITION', message: `Cannot approve a ${booking.status} booking` });
      if (!booking.pendingExpiresAt || booking.pendingExpiresAt <= now) throw new ConflictException({ errorCode: 'BOOKING_EXPIRED', message: 'Pending booking has expired' });
      await tx.update(bookings).set({ status: 'CONFIRMED', pendingExpiresAt: null, version: sql`${bookings.version} + 1`, updatedAt: now })
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId), eq(bookings.status, 'PENDING')));
      await this.appendEvent(tx, tenantId, bookingId, 'business', actorId, 'booking.approved', { from: 'PENDING', to: 'CONFIRMED' });
      return bookingId;
    });
    return this.getBooking(tenantId, id);
  }

  async cancel(tenantId: string, actorId: string, key: string | undefined, bookingId: string, actorType: 'business' | 'guest' = 'business'): Promise<BookingDto> {
    this.assertUuid(bookingId, 'bookingId');
    const idemKey = this.validateIdempotencyKey(key);
    const id = await this.runIdempotent(tenantId, actorId, 'booking.cancel', idemKey, requestHash({ bookingId }), async (tx, now) => {
      const [booking] = await tx.select().from(bookings).where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId))).for('update').limit(1);
      if (!booking) throw new NotFoundException('Booking not found in this tenant');
      if (booking.status === 'EXPIRED') throw new ConflictException({ errorCode: 'BOOKING_EXPIRED', message: 'Pending booking has expired' });
      if (booking.status === 'CANCELLED') return bookingId;
      if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') throw new ConflictException({ errorCode: 'INVALID_TRANSITION', message: `Cannot cancel a ${booking.status} booking` });
      if (actorType === 'guest' && booking.startsAt.getTime() - now.getTime() < booking.policySnapshot.cancellationCutoffMinutes * 60_000) throw new ConflictException({ errorCode: 'CANCELLATION_CUTOFF_PASSED', message: 'The cancellation cutoff has passed' });
      await tx.update(bookings).set({ status: 'CANCELLED', pendingExpiresAt: null, version: sql`${bookings.version} + 1`, updatedAt: now })
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId), inArray(bookings.status, ['PENDING', 'CONFIRMED'])));
      // Quota is consumed when the booking is created and deliberately is not refunded on cancellation.
      await tx.update(bookingAllocations).set({ active: false }).where(and(eq(bookingAllocations.tenantId, tenantId), eq(bookingAllocations.bookingId, bookingId), eq(bookingAllocations.active, true)));
      await this.appendEvent(tx, tenantId, bookingId, actorType, actorId, 'booking.cancelled', { from: booking.status, to: 'CANCELLED' });
      return bookingId;
    });
    return this.getBooking(tenantId, id);
  }

  async reschedule(tenantId: string, locationId: string, actorId: string, key: string | undefined, bookingId: string, dto: RescheduleBookingRequest, actorType: 'business' | 'guest' = 'business'): Promise<BookingDto> {
    this.assertUuid(bookingId, 'bookingId');
    if (!dto || typeof dto !== 'object') throw new BadRequestException('A reschedule request body is required');
    this.validateSelection(dto.staffSelection, dto.staffId);
    const startsAt = this.validateInstant(dto.startsAt);
    const idemKey = this.validateIdempotencyKey(key);
    const id = await this.runIdempotent(tenantId, actorId, 'booking.reschedule', idemKey, requestHash({ bookingId, ...dto }), async (tx, now) => {
      const [booking] = await tx.select().from(bookings).where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId))).for('update').limit(1);
      if (!booking) throw new NotFoundException('Booking not found in this tenant');
      if (booking.status === 'EXPIRED') throw new ConflictException({ errorCode: 'BOOKING_EXPIRED', message: 'Pending booking has expired' });
      if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') throw new ConflictException({ errorCode: 'INVALID_TRANSITION', message: `Cannot reschedule a ${booking.status} booking` });
      if (booking.startsAt <= now) throw new ConflictException({ errorCode: 'BOOKING_ALREADY_STARTED', message: 'A booking cannot be rescheduled after it has started' });
      if (actorType === 'guest' && booking.startsAt.getTime() - now.getTime() < booking.policySnapshot.rescheduleCutoffMinutes * 60_000) throw new ConflictException({ errorCode: 'RESCHEDULE_CUTOFF_PASSED', message: 'The reschedule cutoff has passed' });
      if (booking.status === 'PENDING' && booking.pendingExpiresAt && booking.pendingExpiresAt <= now) throw new ConflictException({ errorCode: 'BOOKING_EXPIRED', message: 'Pending booking has expired' });
      const snapshotServices = booking.serviceSnapshot.services ?? [];
      if (snapshotServices.length > 1) {
        const requested = dto.serviceAssignments;
        if (!Array.isArray(requested) || requested.length !== snapshotServices.length) throw new BadRequestException('A new staff and time assignment is required for every service segment');
        const assignmentRows = requested.map((item, index) => {
          if (!item || typeof item.serviceId !== 'string' || typeof item.staffId !== 'string' || typeof item.startsAt !== 'string') throw new BadRequestException(`serviceAssignments[${index}] is invalid`);
          this.assertUuid(item.serviceId, `serviceAssignments[${index}].serviceId`);
          this.assertUuid(item.staffId, `serviceAssignments[${index}].staffId`);
          const service = snapshotServices.find((saved) => saved.id === item.serviceId);
          if (!service) throw new BadRequestException('Reschedule assignments must keep all booked services');
          return { serviceId: item.serviceId, staffId: item.staffId, startsAt: this.validateInstant(item.startsAt), service };
        }).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
        if (new Set(assignmentRows.map((row) => row.serviceId)).size !== snapshotServices.length || assignmentRows[0].startsAt.getTime() !== startsAt.getTime()) throw new BadRequestException('Reschedule must assign every service and start at the selected time');
        for (let i = 1; i < assignmentRows.length; i += 1) {
          const gap = (assignmentRows[i].startsAt.getTime() - assignmentRows[i - 1].startsAt.getTime() - assignmentRows[i - 1].service.durationMinutes * 60_000) / 60_000;
          if (gap < 0 || gap > 30) throw new BadRequestException('Service gaps may not exceed 30 minutes');
        }
        const { location } = await this.lockBookingInputs(tx, tenantId, locationId, booking.serviceId);
        for (const serviceId of [...snapshotServices.map((item) => item.id)].sort()) await this.lockEligibleStaff(tx, tenantId, locationId, serviceId);
        const validated = [];
        for (const row of assignmentRows) {
          const available = await this.buildAvailability(tenantId, locationId, row.serviceId, formatLocalDate(row.startsAt, location.timezone), row.staffId, { excludeBookingId: bookingId, now });
          const staffIds = await this.rankStaff(tenantId, available, row.startsAt, 'SPECIFIC', row.staffId);
          validated.push({ ...row, staffId: staffIds[0] });
        }
        await tx.update(bookingAllocations).set({ active: false, isCurrent: false }).where(and(eq(bookingAllocations.tenantId, tenantId), eq(bookingAllocations.bookingId, bookingId), eq(bookingAllocations.isCurrent, true)));
        for (let index = 0; index < validated.length; index += 1) await this.insertAllocationWithRetry(tx, tenantId, bookingId, [validated[index].staffId], validated[index].startsAt, validated[index].service, 'SPECIFIC', index);
        const finalSegment = validated.at(-1)!;
        const endsAt = new Date(finalSegment.startsAt.getTime() + finalSegment.service.durationMinutes * 60_000);
        const pendingExpiresAt = booking.status === 'PENDING' && booking.pendingExpiresAt ? new Date(Math.min(booking.pendingExpiresAt.getTime(), startsAt.getTime())) : null;
        const serviceSnapshot = { ...booking.serviceSnapshot, services: validated.map((row, segmentIndex) => ({ ...row.service, id: row.serviceId, staffId: row.staffId, startsAt: row.startsAt.toISOString(), segmentIndex })) };
        await tx.update(bookings).set({ startsAt, endsAt, pendingExpiresAt, serviceSnapshot, version: sql`${bookings.version} + 1`, updatedAt: now }).where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)));
        await this.appendEvent(tx, tenantId, bookingId, actorType, actorId, 'booking.rescheduled', { from: { startsAt: booking.startsAt.toISOString() }, serviceAssignments: validated.map((row) => ({ serviceId: row.serviceId, staffId: row.staffId, startsAt: row.startsAt.toISOString() })) });
        return bookingId;
      }
      const [oldAllocation] = await tx.select().from(bookingAllocations).where(and(eq(bookingAllocations.tenantId, tenantId), eq(bookingAllocations.bookingId, bookingId), eq(bookingAllocations.active, true))).for('update').limit(1);
      if (!oldAllocation) throw new ConflictException({ errorCode: 'INVALID_TRANSITION', message: 'Booking has no active staff allocation' });
      const { location, service } = await this.lockBookingInputs(tx, tenantId, locationId, booking.serviceId);
      await this.lockEligibleStaff(tx, tenantId, locationId, booking.serviceId, [oldAllocation.staffId]);
      const slots = await this.buildAvailability(tenantId, locationId, booking.serviceId, formatLocalDate(startsAt, location.timezone), dto.staffId, { excludeBookingId: bookingId, now, serviceSnapshot: booking.serviceSnapshot });
      const staffIds = await this.rankStaff(tenantId, slots, startsAt, dto.staffSelection, dto.staffId);
      const staffId = staffIds[0];
      if (startsAt.getTime() === booking.startsAt.getTime() && staffId === oldAllocation.staffId) return bookingId;
      const endsAt = new Date(startsAt.getTime() + booking.serviceSnapshot.durationMinutes * 60_000);
      const pendingExpiresAt = booking.status === 'PENDING' && booking.pendingExpiresAt
        ? new Date(Math.min(booking.pendingExpiresAt.getTime(), startsAt.getTime())) : null;
      await tx.update(bookingAllocations).set({ active: false, isCurrent: false }).where(and(eq(bookingAllocations.tenantId, tenantId), eq(bookingAllocations.bookingId, bookingId), eq(bookingAllocations.isCurrent, true)));
      const allocationService = {
        ...service,
        durationMinutes: booking.serviceSnapshot.durationMinutes,
        bufferBeforeMinutes: booking.serviceSnapshot.bufferBeforeMinutes,
        bufferAfterMinutes: booking.serviceSnapshot.bufferAfterMinutes,
      };
      const allocatedStaffId = await this.insertAllocationWithRetry(tx, tenantId, bookingId, staffIds, startsAt, allocationService, dto.staffSelection);
      await tx.update(bookings).set({ startsAt, endsAt, pendingExpiresAt, version: sql`${bookings.version} + 1`, updatedAt: now })
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId)));
      await this.appendEvent(tx, tenantId, bookingId, actorType, actorId, 'booking.rescheduled', {
        from: { startsAt: booking.startsAt.toISOString(), staffId: oldAllocation.staffId },
        to: { startsAt: startsAt.toISOString(), staffId: allocatedStaffId },
      });
      return bookingId;
    });
    return this.getBooking(tenantId, id);
  }

  private async finish(tenantId: string, actorId: string, key: string | undefined, bookingId: string, status: 'COMPLETED' | 'NO_SHOW'): Promise<BookingDto> {
    this.assertUuid(bookingId, 'bookingId');
    const idemKey = this.validateIdempotencyKey(key);
    const id = await this.runIdempotent(tenantId, actorId, `booking.${status.toLowerCase()}`, idemKey, requestHash({ bookingId, status }), async (tx, now) => {
      const [booking] = await tx.select().from(bookings).where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId))).for('update').limit(1);
      if (!booking) throw new NotFoundException('Booking not found in this tenant');
      if (booking.status !== 'CONFIRMED') throw new ConflictException({ errorCode: 'INVALID_TRANSITION', message: `Cannot set ${status} from ${booking.status}` });
      const threshold = booking.startsAt;
      if (threshold > now) throw new ConflictException({ errorCode: 'INVALID_TRANSITION', message: `${status} is only allowed after the appointment has started` });
      await tx.update(bookings).set({ status, pendingExpiresAt: null, version: sql`${bookings.version} + 1`, updatedAt: now })
        .where(and(eq(bookings.tenantId, tenantId), eq(bookings.id, bookingId), eq(bookings.status, 'CONFIRMED')));
      await tx.update(bookingAllocations).set({ active: false }).where(and(eq(bookingAllocations.tenantId, tenantId), eq(bookingAllocations.bookingId, bookingId), eq(bookingAllocations.active, true)));
      await this.appendEvent(tx, tenantId, bookingId, 'business', actorId, `booking.${status.toLowerCase()}`, { from: 'CONFIRMED', to: status });
      return bookingId;
    });
    return this.getBooking(tenantId, id);
  }

  complete(tenantId: string, actorId: string, key: string | undefined, bookingId: string): Promise<BookingDto> {
    return this.finish(tenantId, actorId, key, bookingId, 'COMPLETED');
  }

  noShow(tenantId: string, actorId: string, key: string | undefined, bookingId: string): Promise<BookingDto> {
    return this.finish(tenantId, actorId, key, bookingId, 'NO_SHOW');
  }
}

function dayAllocationsForStaff(rows: Array<{ staffId: string; start: Date; end: Date }>, staffId: string): Array<{ start: Date; end: Date }> {
  return rows.filter((row) => row.staffId === staffId);
}
