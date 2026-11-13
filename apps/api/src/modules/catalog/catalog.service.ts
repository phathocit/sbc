import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateScheduleExceptionRequest, CreateServiceRequest, CreateStaffRequest, CreateStaffShiftTemplateRequest,
  ScheduleExceptionDto, ServiceDto, StaffDto, StaffShiftTemplateDto, UpdateServiceRequest, UpdateStaffRequest,
  WeeklyWorkingHoursRequest, WorkingHourDto, WorkingHoursRequest,
} from '@sbc/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  businessHours, locations, memberships, scheduleExceptions, services, staffHours, staffShiftTemplates, staffShiftTemplateIntervals,
  staffProfiles, staffServices,
} from '../../../../../packages/database/dist/schema/index.js';
import { db } from '../../database';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class CatalogService {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}
  private cleanName(name: string): string {
    const value = typeof name === 'string' ? name.trim() : '';
    if (!value || value.length > 160) throw new BadRequestException('Name is required and must be at most 160 characters');
    return value;
  }

  private validateServiceFields(dto: Partial<CreateServiceRequest>): void {
    if (dto.durationMinutes !== undefined && (!Number.isInteger(dto.durationMinutes) || dto.durationMinutes < 1 || dto.durationMinutes > 1440)) throw new BadRequestException('Duration must be between 1 and 1440 minutes');
    for (const [field, value] of [['bufferBeforeMinutes', dto.bufferBeforeMinutes], ['bufferAfterMinutes', dto.bufferAfterMinutes], ['priceMinor', dto.priceMinor]] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 2_000_000_000)) throw new BadRequestException(`${field} must be a non-negative integer`);
    }
    if (dto.description !== undefined && dto.description !== null && dto.description.length > 2000) throw new BadRequestException('Description must be at most 2000 characters');
    if (dto.description !== undefined && dto.description !== null && typeof dto.description !== 'string') throw new BadRequestException('Description must be text');
    if (dto.currency !== undefined && (typeof dto.currency !== 'string' || !/^[A-Za-z]{3}$/.test(dto.currency))) throw new BadRequestException('Currency must be a 3-letter ISO code');
    if (dto.active !== undefined && typeof dto.active !== 'boolean') throw new BadRequestException('active must be a boolean');
    if (dto.published !== undefined && typeof dto.published !== 'boolean') throw new BadRequestException('published must be a boolean');
  }

  private mapService(row: typeof services.$inferSelect): ServiceDto {
    return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  async listServices(tenantId: string): Promise<ServiceDto[]> {
    const rows = await db.select().from(services).where(eq(services.tenantId, tenantId)).orderBy(asc(services.name));
    return rows.map((row) => this.mapService(row));
  }

  async createService(tenantId: string, locationId: string, dto: CreateServiceRequest): Promise<ServiceDto> {
    this.validateServiceFields(dto);
    if (!Number.isInteger(dto.durationMinutes) || !Number.isInteger(dto.priceMinor)) throw new BadRequestException('Duration and price are required integer values');
    const name = this.cleanName(dto.name);
    const [location] = await db.select({ currency: locations.currency }).from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId), eq(locations.active, true))).limit(1);
    if (!location) throw new NotFoundException('Active tenant location not found');
    const currency = (dto.currency ?? location.currency).toUpperCase();
    if (currency !== location.currency) throw new BadRequestException('Service currency must match the active location currency');
    const [row] = await db.insert(services).values({
      tenantId, name, description: dto.description?.trim() || null, durationMinutes: dto.durationMinutes,
      bufferBeforeMinutes: dto.bufferBeforeMinutes ?? 0, bufferAfterMinutes: dto.bufferAfterMinutes ?? 0,
      priceMinor: dto.priceMinor, currency, active: dto.active ?? true, published: dto.published ?? false,
    }).returning();
    return this.mapService(row);
  }

  async updateService(tenantId: string, serviceId: string, dto: UpdateServiceRequest): Promise<ServiceDto> {
    this.validateServiceFields(dto);
    const [current] = await db.select().from(services).where(and(eq(services.tenantId, tenantId), eq(services.id, serviceId))).limit(1);
    if (!current) throw new NotFoundException('Service not found in this tenant');
    const update: Partial<typeof services.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) update.name = this.cleanName(dto.name);
    if (dto.description !== undefined) update.description = dto.description?.trim() || null;
    if (dto.durationMinutes !== undefined) update.durationMinutes = dto.durationMinutes;
    if (dto.bufferBeforeMinutes !== undefined) update.bufferBeforeMinutes = dto.bufferBeforeMinutes;
    if (dto.bufferAfterMinutes !== undefined) update.bufferAfterMinutes = dto.bufferAfterMinutes;
    if (dto.priceMinor !== undefined) update.priceMinor = dto.priceMinor;
    if (dto.currency !== undefined && dto.currency.toUpperCase() !== current.currency) throw new BadRequestException('Service currency cannot be changed after creation');
    if (dto.active !== undefined) update.active = dto.active;
    if (dto.published !== undefined) update.published = dto.published;
    const [row] = await db.update(services).set(update).where(and(eq(services.tenantId, tenantId), eq(services.id, serviceId))).returning();
    return this.mapService(row);
  }

  private async mapStaff(tenantId: string, row: typeof staffProfiles.$inferSelect): Promise<StaffDto> {
    const links = await db.select({ serviceId: staffServices.serviceId }).from(staffServices).where(and(eq(staffServices.tenantId, tenantId), eq(staffServices.staffId, row.id)));
    return { ...row, serviceIds: links.map((link) => link.serviceId), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  async listStaff(tenantId: string): Promise<StaffDto[]> {
    const rows = await db.select().from(staffProfiles).where(eq(staffProfiles.tenantId, tenantId)).orderBy(asc(staffProfiles.name));
    return Promise.all(rows.map((row) => this.mapStaff(tenantId, row)));
  }

  private async validateServiceIds(tenantId: string, ids: string[] | undefined): Promise<string[]> {
    if (ids !== undefined && !Array.isArray(ids)) throw new BadRequestException('serviceIds must be an array');
    const normalized = [...new Set(ids ?? [])];
    if (normalized.some((id) => typeof id !== 'string')) throw new BadRequestException('Service IDs must be strings');
    if (normalized.length) {
      const found = await db.select({ id: services.id }).from(services).where(and(eq(services.tenantId, tenantId), inArray(services.id, normalized)));
      if (found.length !== normalized.length) throw new BadRequestException('Every eligible service must belong to this tenant');
    }
    return normalized;
  }

  async createStaff(tenantId: string, locationId: string, dto: CreateStaffRequest): Promise<StaffDto> {
    const name = this.cleanName(dto.name);
    const ids = await this.validateServiceIds(tenantId, dto.serviceIds);
    if (dto.userId !== undefined && dto.userId !== null && typeof dto.userId !== 'string') throw new BadRequestException('userId must be a string or null');
    if (dto.active !== undefined && typeof dto.active !== 'boolean') throw new BadRequestException('active must be a boolean');
    if (dto.userId) {
      const [member] = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, dto.userId), eq(memberships.status, 'active'))).limit(1);
      if (!member) throw new BadRequestException('Linked user must be an active member of this tenant');
    }
    const row = await db.transaction(async (tx) => {
      const [location] = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId), eq(locations.active, true))).for('update').limit(1);
      if (!location) throw new NotFoundException('Active tenant location not found');
      if (dto.active ?? true) await this.billing.assertStaffCapacity(tx, tenantId);
      const [created] = await tx.insert(staffProfiles).values({ tenantId, locationId, userId: dto.userId || null, name, active: dto.active ?? true }).returning();
      if (ids.length) await tx.insert(staffServices).values(ids.map((serviceId) => ({ tenantId, staffId: created.id, serviceId })));
      return created;
    });
    return this.mapStaff(tenantId, row);
  }

  async updateStaff(tenantId: string, staffId: string, dto: UpdateStaffRequest): Promise<StaffDto> {
    const [current] = await db.select().from(staffProfiles).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.id, staffId))).limit(1);
    if (!current) throw new NotFoundException('Staff profile not found in this tenant');
    const update: Partial<typeof staffProfiles.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) update.name = this.cleanName(dto.name);
    if (dto.active !== undefined) {
      if (typeof dto.active !== 'boolean') throw new BadRequestException('active must be a boolean');
      update.active = dto.active;
    }
    if (dto.userId !== undefined) {
      if (dto.userId !== null && typeof dto.userId !== 'string') throw new BadRequestException('userId must be a string or null');
      if (dto.userId) {
        const [member] = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, dto.userId), eq(memberships.status, 'active'))).limit(1);
        if (!member) throw new BadRequestException('Linked user must be an active member of this tenant');
      }
      update.userId = dto.userId || null;
    }
    const ids = dto.serviceIds === undefined ? undefined : await this.validateServiceIds(tenantId, dto.serviceIds);
    const row = await db.transaction(async (tx) => {
      if (dto.active === true) {
        const [location] = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, current.locationId), eq(locations.active, true))).for('update').limit(1);
        if (!location) throw new NotFoundException('Active tenant location not found');
        const [latest] = await tx.select({ active: staffProfiles.active }).from(staffProfiles)
          .where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.id, staffId))).for('update').limit(1);
        if (latest && !latest.active) await this.billing.assertStaffCapacity(tx, tenantId);
      }
      const [updated] = await tx.update(staffProfiles).set(update).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.id, staffId))).returning();
      if (ids) {
        await tx.delete(staffServices).where(and(eq(staffServices.tenantId, tenantId), eq(staffServices.staffId, staffId)));
        if (ids.length) await tx.insert(staffServices).values(ids.map((serviceId) => ({ tenantId, staffId, serviceId })));
      }
      return updated;
    });
    return this.mapStaff(tenantId, row);
  }

  private validateHours(dto: WorkingHoursRequest): void {
    if (!Number.isInteger(dto.weekday) || dto.weekday < 0 || dto.weekday > 6 || !Array.isArray(dto.intervals)) throw new BadRequestException('Weekday must be 0–6 and intervals must be an array');
    for (const interval of dto.intervals) {
      if (!interval || typeof interval.localStart !== 'string' || typeof interval.localEnd !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(interval.localStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(interval.localEnd) || interval.localStart >= interval.localEnd) throw new BadRequestException('Each interval needs valid HH:mm local times and must end after it starts');
    }
    const sorted = [...dto.intervals].sort((a, b) => a.localStart.localeCompare(b.localStart));
    for (let i = 1; i < sorted.length; i += 1) if (sorted[i].localStart < sorted[i - 1].localEnd) throw new BadRequestException('Working hour intervals cannot overlap');
  }

  async listBusinessHours(tenantId: string, locationId: string): Promise<WorkingHourDto[]> {
    const rows = await db.select().from(businessHours).where(and(eq(businessHours.tenantId, tenantId), eq(businessHours.locationId, locationId))).orderBy(asc(businessHours.weekday), asc(businessHours.localStart));
    return rows.map((r) => ({ id: r.id, tenantId: r.tenantId, weekday: r.weekday, localStart: r.localStart, localEnd: r.localEnd }));
  }

  async setBusinessHours(tenantId: string, locationId: string, dto: WorkingHoursRequest): Promise<WorkingHourDto[]> {
    this.validateHours(dto);
    return db.transaction(async (tx) => {
      const [location] = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId), eq(locations.active, true))).for('update').limit(1);
      if (!location) throw new NotFoundException('Active tenant location not found');
      await tx.select({ id: staffProfiles.id }).from(staffProfiles).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.locationId, locationId))).orderBy(asc(staffProfiles.id)).for('update');
      await tx.delete(businessHours).where(and(eq(businessHours.tenantId, tenantId), eq(businessHours.locationId, locationId), eq(businessHours.weekday, dto.weekday)));
      if (dto.intervals.length) await tx.insert(businessHours).values(dto.intervals.map((i) => ({ tenantId, locationId, weekday: dto.weekday, localStart: i.localStart, localEnd: i.localEnd })));
      const rows = await tx.select().from(businessHours).where(and(eq(businessHours.tenantId, tenantId), eq(businessHours.locationId, locationId), eq(businessHours.weekday, dto.weekday))).orderBy(asc(businessHours.localStart));
      return rows.map((r) => ({ id: r.id, tenantId: r.tenantId, weekday: r.weekday, localStart: r.localStart, localEnd: r.localEnd }));
    });
  }

  async setBusinessHoursWeek(tenantId: string, locationId: string, dto: WeeklyWorkingHoursRequest): Promise<WorkingHourDto[]> {
    if (!dto || !Array.isArray(dto.days) || dto.days.length !== 7 || new Set(dto.days.map((day) => day?.weekday)).size !== 7 || dto.days.some((day) => !day || !Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6)) {
      throw new BadRequestException('A complete weekly schedule with weekdays 0–6 is required');
    }
    for (const day of dto.days) this.validateHours(day);
    return db.transaction(async (tx) => {
      const [location] = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId), eq(locations.active, true))).for('update').limit(1);
      if (!location) throw new NotFoundException('Active tenant location not found');
      await tx.select({ id: staffProfiles.id }).from(staffProfiles).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.locationId, locationId))).orderBy(asc(staffProfiles.id)).for('update');
      await tx.delete(businessHours).where(and(eq(businessHours.tenantId, tenantId), eq(businessHours.locationId, locationId)));
      const values = dto.days.flatMap((day) => day.intervals.map((interval) => ({ tenantId, locationId, weekday: day.weekday, localStart: interval.localStart, localEnd: interval.localEnd })));
      if (values.length) await tx.insert(businessHours).values(values);
      const rows = await tx.select().from(businessHours).where(and(eq(businessHours.tenantId, tenantId), eq(businessHours.locationId, locationId))).orderBy(asc(businessHours.weekday), asc(businessHours.localStart));
      return rows.map((row) => ({ id: row.id, tenantId: row.tenantId, weekday: row.weekday, localStart: row.localStart, localEnd: row.localEnd }));
    });
  }

  async listStaffHours(tenantId: string, staffId: string): Promise<WorkingHourDto[]> {
    await this.requireStaff(tenantId, staffId);
    const rows = await db.select().from(staffHours).where(and(eq(staffHours.tenantId, tenantId), eq(staffHours.staffId, staffId))).orderBy(asc(staffHours.weekday), asc(staffHours.localStart));
    return rows.map((r) => ({ id: r.id, tenantId: r.tenantId, weekday: r.weekday, localStart: r.localStart, localEnd: r.localEnd }));
  }

  async listStaffShiftTemplates(tenantId: string): Promise<StaffShiftTemplateDto[]> {
    const templates = await db.select().from(staffShiftTemplates).where(eq(staffShiftTemplates.tenantId, tenantId)).orderBy(asc(staffShiftTemplates.name));
    if (!templates.length) return [];
    const intervals = await db.select().from(staffShiftTemplateIntervals).where(and(eq(staffShiftTemplateIntervals.tenantId, tenantId), inArray(staffShiftTemplateIntervals.templateId, templates.map((template) => template.id)))).orderBy(asc(staffShiftTemplateIntervals.localStart));
    const byTemplate = new Map<string, typeof intervals>();
    for (const interval of intervals) byTemplate.set(interval.templateId, [...(byTemplate.get(interval.templateId) ?? []), interval]);
    return templates.map((template) => ({
      id: template.id, tenantId: template.tenantId, name: template.name,
      intervals: (byTemplate.get(template.id) ?? []).map(({ localStart, localEnd }) => ({ localStart, localEnd })),
      createdAt: template.createdAt.toISOString(), updatedAt: template.updatedAt.toISOString(),
    }));
  }

  private validateStaffShiftTemplate(dto: CreateStaffShiftTemplateRequest): { name: string; intervals: Array<{ localStart: string; localEnd: string }> } {
    if (!dto || typeof dto !== 'object') throw new BadRequestException('Shift template details are required');
    const name = typeof dto?.name === 'string' ? dto.name.trim() : '';
    if (!name || name.length > 80) throw new BadRequestException('Shift name is required and must be at most 80 characters');
    if (!Array.isArray(dto.intervals) || dto.intervals.length < 1 || dto.intervals.length > 8) throw new BadRequestException('A shift must have between 1 and 8 time intervals');
    this.validateHours({ weekday: 1, intervals: dto.intervals });
    return { name, intervals: dto.intervals };
  }

  async createStaffShiftTemplate(tenantId: string, dto: CreateStaffShiftTemplateRequest): Promise<StaffShiftTemplateDto> {
    const clean = this.validateStaffShiftTemplate(dto);
    const [row] = await db.transaction(async (tx) => {
      const [duplicate] = await tx.select({ id: staffShiftTemplates.id }).from(staffShiftTemplates).where(and(eq(staffShiftTemplates.tenantId, tenantId), sql`lower(${staffShiftTemplates.name}) = lower(${clean.name})`)).limit(1);
      if (duplicate) throw new BadRequestException('A shift with this name already exists');
      const [template] = await tx.insert(staffShiftTemplates).values({ tenantId, name: clean.name }).returning();
      await tx.insert(staffShiftTemplateIntervals).values(clean.intervals.map((interval) => ({ tenantId, templateId: template.id, ...interval })));
      return [template];
    });
    return { id: row.id, tenantId: row.tenantId, name: row.name, intervals: clean.intervals, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  async updateStaffShiftTemplate(tenantId: string, templateId: string, dto: CreateStaffShiftTemplateRequest): Promise<StaffShiftTemplateDto> {
    const clean = this.validateStaffShiftTemplate(dto);
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(staffShiftTemplates).where(and(eq(staffShiftTemplates.tenantId, tenantId), eq(staffShiftTemplates.id, templateId))).for('update').limit(1);
      if (!current) throw new NotFoundException('Shift template not found in this tenant');
      const [duplicate] = await tx.select({ id: staffShiftTemplates.id }).from(staffShiftTemplates).where(and(eq(staffShiftTemplates.tenantId, tenantId), sql`lower(${staffShiftTemplates.name}) = lower(${clean.name})`, sql`${staffShiftTemplates.id} <> ${templateId}`)).limit(1);
      if (duplicate) throw new BadRequestException('A shift with this name already exists');
      const [template] = await tx.update(staffShiftTemplates).set({ name: clean.name, updatedAt: new Date() }).where(and(eq(staffShiftTemplates.tenantId, tenantId), eq(staffShiftTemplates.id, templateId))).returning();
      await tx.delete(staffShiftTemplateIntervals).where(and(eq(staffShiftTemplateIntervals.tenantId, tenantId), eq(staffShiftTemplateIntervals.templateId, templateId)));
      await tx.insert(staffShiftTemplateIntervals).values(clean.intervals.map((interval) => ({ tenantId, templateId, ...interval })));
      return template;
    });
    return { id: result.id, tenantId: result.tenantId, name: result.name, intervals: clean.intervals, createdAt: result.createdAt.toISOString(), updatedAt: result.updatedAt.toISOString() };
  }

  async setStaffHours(tenantId: string, staffId: string, dto: WorkingHoursRequest): Promise<WorkingHourDto[]> {
    this.validateHours(dto);
    return db.transaction(async (tx) => {
      const [staff] = await tx.select({ id: staffProfiles.id, locationId: staffProfiles.locationId }).from(staffProfiles).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.id, staffId))).limit(1);
      if (!staff) throw new NotFoundException('Staff profile not found in this tenant');
      const [location] = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, staff.locationId))).for('update').limit(1);
      if (!location) throw new NotFoundException('Tenant location not found');
      await tx.select({ id: staffProfiles.id }).from(staffProfiles).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.id, staffId))).for('update');
      await tx.delete(staffHours).where(and(eq(staffHours.tenantId, tenantId), eq(staffHours.staffId, staffId), eq(staffHours.weekday, dto.weekday)));
      if (dto.intervals.length) await tx.insert(staffHours).values(dto.intervals.map((i) => ({ tenantId, staffId, weekday: dto.weekday, localStart: i.localStart, localEnd: i.localEnd })));
      const rows = await tx.select().from(staffHours).where(and(eq(staffHours.tenantId, tenantId), eq(staffHours.staffId, staffId), eq(staffHours.weekday, dto.weekday))).orderBy(asc(staffHours.localStart));
      return rows.map((r) => ({ id: r.id, tenantId: r.tenantId, weekday: r.weekday, localStart: r.localStart, localEnd: r.localEnd }));
    });
  }

  private async requireStaff(tenantId: string, staffId: string): Promise<void> {
    const [row] = await db.select({ id: staffProfiles.id }).from(staffProfiles).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.id, staffId))).limit(1);
    if (!row) throw new NotFoundException('Staff profile not found in this tenant');
  }

  async listExceptions(tenantId: string): Promise<ScheduleExceptionDto[]> {
    const rows = await db.select().from(scheduleExceptions).where(eq(scheduleExceptions.tenantId, tenantId)).orderBy(asc(scheduleExceptions.onDate), asc(scheduleExceptions.localStart));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) as ScheduleExceptionDto[];
  }

  async createException(tenantId: string, locationId: string, dto: CreateScheduleExceptionRequest): Promise<ScheduleExceptionDto> {
    if (!['location', 'staff'].includes(dto.scope) || !['unavailable', 'available'].includes(dto.kind)) throw new BadRequestException('Invalid exception scope or kind');
    if (typeof dto.onDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dto.onDate) || Number.isNaN(Date.parse(`${dto.onDate}T00:00:00Z`)) || new Date(`${dto.onDate}T00:00:00Z`).toISOString().slice(0, 10) !== dto.onDate) throw new BadRequestException('Date must use a valid YYYY-MM-DD date');
    this.validateHours({ weekday: 0, intervals: [{ localStart: dto.localStart, localEnd: dto.localEnd }] });
    if (dto.reason !== undefined && (typeof dto.reason !== 'string' || dto.reason.length > 500)) throw new BadRequestException('Reason must be text with at most 500 characters');
    let staffLocationId = locationId;
    if (dto.scope === 'staff') {
      if (!dto.staffId) throw new BadRequestException('Staff exception requires staffId');
      const [staff] = await db.select({ locationId: staffProfiles.locationId }).from(staffProfiles).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.id, dto.staffId))).limit(1);
      if (!staff) throw new NotFoundException('Staff profile not found in this tenant');
      staffLocationId = staff.locationId;
    }
    const [row] = await db.transaction(async (tx) => {
      const [location] = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, staffLocationId))).for('update').limit(1);
      if (!location) throw new NotFoundException('Tenant location not found');
      if (dto.scope === 'location') {
        await tx.select({ id: staffProfiles.id }).from(staffProfiles).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.locationId, locationId))).orderBy(asc(staffProfiles.id)).for('update');
      } else {
        await tx.select({ id: staffProfiles.id }).from(staffProfiles).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.id, dto.staffId!))).for('update');
      }
      return tx.insert(scheduleExceptions).values({
        tenantId, scope: dto.scope, locationId: dto.scope === 'location' ? locationId : null,
        staffId: dto.scope === 'staff' ? dto.staffId : null, onDate: dto.onDate,
        localStart: dto.localStart, localEnd: dto.localEnd, kind: dto.kind, reason: dto.reason?.trim() || null,
      }).returning().then((rows) => rows[0]);
    });
    return { ...row, createdAt: row.createdAt.toISOString() } as ScheduleExceptionDto;
  }

  async deactivateException(tenantId: string, exceptionId: string): Promise<ScheduleExceptionDto> {
    const row = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(scheduleExceptions).where(and(eq(scheduleExceptions.tenantId, tenantId), eq(scheduleExceptions.id, exceptionId))).for('update').limit(1);
      if (!current) throw new NotFoundException('Schedule exception not found in this tenant');
      const locationId = current.locationId ?? (await tx.select({ locationId: staffProfiles.locationId }).from(staffProfiles).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.id, current.staffId!))).limit(1))[0]?.locationId;
      if (!locationId) throw new NotFoundException('Schedule exception target no longer exists');
      const [location] = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId))).for('update').limit(1);
      if (!location) throw new NotFoundException('Tenant location not found');
      if (current.scope === 'location') {
        await tx.select({ id: staffProfiles.id }).from(staffProfiles).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.locationId, locationId))).orderBy(asc(staffProfiles.id)).for('update');
      } else {
        await tx.select({ id: staffProfiles.id }).from(staffProfiles).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.id, current.staffId!))).for('update');
      }
      const [updated] = await tx.update(scheduleExceptions).set({ active: false, updatedAt: new Date() }).where(and(eq(scheduleExceptions.tenantId, tenantId), eq(scheduleExceptions.id, exceptionId))).returning();
      return updated;
    });
    return { ...row, createdAt: row.createdAt.toISOString() } as ScheduleExceptionDto;
  }
}
