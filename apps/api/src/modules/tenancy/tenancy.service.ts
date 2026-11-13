import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  ConfirmationMode,
  CreateTenantRequest,
  LocationDto,
  MembershipRole,
  MembershipStatus,
  TenantContextDto,
  TenantDto,
  TenantPolicyDto,
  TenantStatus,
  UpdateLocationRequest,
  UpdateTenantPolicyRequest,
  UpdateTenantRequest,
  UpdateTenantThemeRequest,
  TenantThemeKey,
  TenantThemeMode,
} from '@sbc/contracts';
import type { Location, Membership, Tenant, TenantPolicy, User } from '@sbc/database';
import {
  locations,
  memberships,
  planCatalog,
  tenantPolicies,
  tenantSubscriptions,
  tenants,
} from '../../../../../packages/database/dist/schema/index.js';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../database';

@Injectable()
export class TenancyService {
  private readonly tenantThemeKeys: TenantThemeKey[] = [
    'blueberry-cream', 'peach-soda', 'matcha-latte', 'lavender-pop',
    'strawberry-milk', 'minty-fresh', 'coral-bloom', 'lemon-sorbet', 'cotton-candy',
  ];
  private validateSlug(slug: string): string {
    const normalized = slug?.trim().toLowerCase();
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    if (!normalized || normalized.length < 3 || normalized.length > 63 || !slugRegex.test(normalized)) {
      throw new BadRequestException(
        'Slug must be between 3 and 63 lowercase alphanumeric characters, optionally separated by single hyphens',
      );
    }
    return normalized;
  }

  private validateTimezone(tz: string): string {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return tz;
    } catch {
      throw new BadRequestException(`'${tz}' is not a valid IANA timezone string`);
    }
  }

  private validateCurrency(currency: string): string {
    const normalized = currency?.trim().toUpperCase();
    if (!normalized || normalized.length !== 3 || !/^[A-Z]{3}$/.test(normalized)) {
      throw new BadRequestException('Currency must be a 3-letter ISO code (e.g. USD, EUR, VND)');
    }
    return normalized;
  }

  private mapTenantToDto(tenant: Tenant): TenantDto {
    return {
      id: tenant.id,
      slug: tenant.slug,
      displayName: tenant.displayName,
      status: tenant.status as TenantStatus,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  }

  private mapLocationToDto(location: Location): LocationDto {
    return {
      id: location.id,
      tenantId: location.tenantId,
      name: location.name,
      timezone: location.timezone,
      currency: location.currency,
      active: location.active,
      createdAt: location.createdAt.toISOString(),
      updatedAt: location.updatedAt.toISOString(),
    };
  }

  private mapPolicyToDto(policy: TenantPolicy): TenantPolicyDto {
    return {
      tenantId: policy.tenantId,
      confirmationMode: policy.confirmationMode as ConfirmationMode,
      pendingExpiryMinutes: policy.pendingExpiryMinutes,
      cancellationCutoffMinutes: policy.cancellationCutoffMinutes,
      rescheduleCutoffMinutes: policy.rescheduleCutoffMinutes,
      minLeadMinutes: policy.minLeadMinutes,
      bookingHorizonDays: policy.bookingHorizonDays,
      slotIntervalMinutes: policy.slotIntervalMinutes,
      appointmentReminderMinutes: policy.appointmentReminderMinutes,
      version: policy.version,
      createdAt: policy.createdAt.toISOString(),
      updatedAt: policy.updatedAt.toISOString(),
    };
  }

  async createTenant(userId: string, dto: CreateTenantRequest): Promise<{
    tenant: TenantDto;
    location: LocationDto;
    policy: TenantPolicyDto;
  }> {
    const slug = this.validateSlug(dto.slug);
    const displayName = dto.name?.trim();
    if (!displayName) {
      throw new BadRequestException('Tenant name is required');
    }

    const timezone = dto.timezone ? this.validateTimezone(dto.timezone) : 'UTC';
    const currency = dto.currency ? this.validateCurrency(dto.currency) : 'USD';

    const [existing] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);

    if (existing) {
      throw new ConflictException({
        statusCode: 409,
        errorCode: 'SLUG_ALREADY_EXISTS',
        message: `Tenant slug '${slug}' is already taken`,
      });
    }

    // Atomic transaction for tenant, owner membership, initial active location and policies
    return await db.transaction(async (tx) => {
      const [newTenant] = await tx
        .insert(tenants)
        .values({
          slug,
          displayName,
          status: 'active',
        })
        .returning();

      const [freePlan] = await tx.select().from(planCatalog).where(and(eq(planCatalog.code, 'free'), eq(planCatalog.isActive, true))).limit(1);
      if (!freePlan) throw new ServiceUnavailableException('Free plan catalog is not initialized; apply migration 0008');
      const periodStart = new Date();
      const periodEnd = new Date(periodStart);
      const day = periodEnd.getUTCDate();
      periodEnd.setUTCDate(1);
      periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
      periodEnd.setUTCDate(Math.min(day, new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 1, 0)).getUTCDate()));
      await tx.insert(tenantSubscriptions).values({ tenantId: newTenant.id, planId: freePlan.id, status: 'active', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd });

      await tx.insert(memberships).values({
        tenantId: newTenant.id,
        userId,
        role: 'owner',
        status: 'active',
      });

      const [newLocation] = await tx
        .insert(locations)
        .values({
          tenantId: newTenant.id,
          name: 'Main Location',
          timezone,
          currency,
          active: true,
        })
        .returning();

      const [newPolicy] = await tx
        .insert(tenantPolicies)
        .values({
          tenantId: newTenant.id,
          confirmationMode: 'AUTO',
          pendingExpiryMinutes: 120,
          cancellationCutoffMinutes: 1440,
          rescheduleCutoffMinutes: 1440,
          minLeadMinutes: 60,
          bookingHorizonDays: 30,
          slotIntervalMinutes: 15,
          version: 1,
        })
        .returning();

      return {
        tenant: this.mapTenantToDto(newTenant),
        location: this.mapLocationToDto(newLocation),
        policy: this.mapPolicyToDto(newPolicy),
      };
    });
  }

  async listUserTenants(userId: string): Promise<
    Array<{
      tenant: TenantDto;
      role: MembershipRole;
      status: MembershipStatus;
    }>
  > {
    const rows = await db
      .select({
        tenant: tenants,
        role: memberships.role,
        status: memberships.status,
      })
      .from(memberships)
      .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')));

    return rows.map((r) => ({
      tenant: this.mapTenantToDto(r.tenant),
      role: r.role as MembershipRole,
      status: r.status as MembershipStatus,
    }));
  }

  async getCurrentTenantContext(tenantId: string, userId: string): Promise<TenantContextDto> {
    const [row] = await db
      .select({
        tenant: tenants,
        role: memberships.role,
        status: memberships.status,
      })
      .from(memberships)
      .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.userId, userId),
          eq(memberships.status, 'active'),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException('Tenant context not found for user');
    }

    const [location] = await db
      .select()
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.active, true)))
      .limit(1);

    if (!location) {
      throw new NotFoundException('Active location not found for tenant');
    }

    return {
      tenant: this.mapTenantToDto(row.tenant),
      location: this.mapLocationToDto(location),
      role: row.role as MembershipRole,
      status: row.status as MembershipStatus,
      themeKey: row.tenant.themeKey as TenantThemeKey | null,
      themeMode: row.tenant.themeMode as TenantThemeMode,
    };
  }

  async updateTenantTheme(tenantId: string, dto: UpdateTenantThemeRequest): Promise<{ themeKey: string | null; themeMode: TenantThemeMode }> {
    const themeKey = dto?.themeKey;
    const themeMode = dto?.themeMode;
    if (themeKey !== null && (typeof themeKey !== 'string' || !this.tenantThemeKeys.includes(themeKey as TenantThemeKey))) {
      throw new BadRequestException('Unsupported tenant theme');
    }
    if (themeMode !== 'light' && themeMode !== 'dark') throw new BadRequestException('Unsupported tenant theme mode');
    const [updated] = await db.update(tenants).set({ themeKey, themeMode, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId)).returning({ themeKey: tenants.themeKey, themeMode: tenants.themeMode });
    if (!updated) throw new NotFoundException('Tenant not found');
    return { themeKey: updated.themeKey as TenantThemeKey | null, themeMode: updated.themeMode as TenantThemeMode };
  }

  async updateTenant(tenantId: string, dto: UpdateTenantRequest): Promise<TenantDto> {
    const updateValues: Partial<typeof tenants.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (dto.displayName !== undefined) {
      const name = dto.displayName.trim();
      if (!name) {
        throw new BadRequestException('Tenant name cannot be empty');
      }
      updateValues.displayName = name;
    }

    if (dto.slug !== undefined) {
      const slug = this.validateSlug(dto.slug);
      const [existing] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1);

      if (existing && existing.id !== tenantId) {
        throw new ConflictException({
          statusCode: 409,
          errorCode: 'SLUG_ALREADY_EXISTS',
          message: `Slug '${slug}' is already taken`,
        });
      }
      updateValues.slug = slug;
    }

    const [updated] = await db
      .update(tenants)
      .set(updateValues)
      .where(eq(tenants.id, tenantId))
      .returning();

    if (!updated) {
      throw new NotFoundException('Tenant not found');
    }

    return this.mapTenantToDto(updated);
  }

  async getTenantPolicies(tenantId: string): Promise<TenantPolicyDto> {
    const [policy] = await db
      .select()
      .from(tenantPolicies)
      .where(eq(tenantPolicies.tenantId, tenantId))
      .limit(1);

    if (!policy) {
      throw new NotFoundException('Policies not found for this tenant');
    }

    return this.mapPolicyToDto(policy);
  }

  async updateTenantPolicies(
    tenantId: string,
    dto: UpdateTenantPolicyRequest,
  ): Promise<TenantPolicyDto> {
    const updateValues: Partial<typeof tenantPolicies.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (dto.confirmationMode !== undefined) {
      if (!['AUTO', 'MANUAL'].includes(dto.confirmationMode)) {
        throw new BadRequestException("Confirmation mode must be 'AUTO' or 'MANUAL'");
      }
      updateValues.confirmationMode = dto.confirmationMode;
    }

    if (dto.pendingExpiryMinutes !== undefined) {
      if (dto.pendingExpiryMinutes < 15 || dto.pendingExpiryMinutes > 1440) {
        throw new BadRequestException('Pending expiry must be between 15 and 1440 minutes');
      }
      updateValues.pendingExpiryMinutes = dto.pendingExpiryMinutes;
    }

    if (dto.cancellationCutoffMinutes !== undefined) {
      if (dto.cancellationCutoffMinutes < 0 || dto.cancellationCutoffMinutes > 4320) {
        throw new BadRequestException('Cancellation cutoff must be between 0 and 4320 minutes');
      }
      updateValues.cancellationCutoffMinutes = dto.cancellationCutoffMinutes;
    }

    if (dto.rescheduleCutoffMinutes !== undefined) {
      if (dto.rescheduleCutoffMinutes < 0 || dto.rescheduleCutoffMinutes > 4320) {
        throw new BadRequestException('Reschedule cutoff must be between 0 and 4320 minutes');
      }
      updateValues.rescheduleCutoffMinutes = dto.rescheduleCutoffMinutes;
    }

    if (dto.minLeadMinutes !== undefined) {
      if (dto.minLeadMinutes < 0 || dto.minLeadMinutes > 4320) {
        throw new BadRequestException('Minimum lead time must be between 0 and 4320 minutes');
      }
      updateValues.minLeadMinutes = dto.minLeadMinutes;
    }

    if (dto.bookingHorizonDays !== undefined) {
      if (dto.bookingHorizonDays < 1 || dto.bookingHorizonDays > 90) {
        throw new BadRequestException('Booking horizon must be between 1 and 90 days');
      }
      updateValues.bookingHorizonDays = dto.bookingHorizonDays;
    }

    if (dto.slotIntervalMinutes !== undefined) {
      if (![5, 10, 15, 30, 60].includes(dto.slotIntervalMinutes)) {
        throw new BadRequestException('Slot interval must be 5, 10, 15, 30, or 60 minutes');
      }
      updateValues.slotIntervalMinutes = dto.slotIntervalMinutes;
    }

    if (dto.appointmentReminderMinutes !== undefined) {
      if (dto.appointmentReminderMinutes !== null && (!Number.isInteger(dto.appointmentReminderMinutes) || dto.appointmentReminderMinutes < 1 || dto.appointmentReminderMinutes > 1440)) {
        throw new BadRequestException('Appointment reminder must be disabled or between 1 and 1440 minutes');
      }
      updateValues.appointmentReminderMinutes = dto.appointmentReminderMinutes;
    }

    const [updated] = await db
      .update(tenantPolicies)
      .set({
        ...updateValues,
        version: sql`${tenantPolicies.version} + 1`,
      })
      .where(eq(tenantPolicies.tenantId, tenantId))
      .returning();

    if (!updated) {
      throw new NotFoundException('Tenant policy not found');
    }

    return this.mapPolicyToDto(updated);
  }

  async getCurrentLocation(tenantId: string): Promise<LocationDto> {
    const [location] = await db
      .select()
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.active, true)))
      .limit(1);

    if (!location) {
      throw new NotFoundException('Active location not found for tenant');
    }

    return this.mapLocationToDto(location);
  }

  async updateCurrentLocation(tenantId: string, dto: UpdateLocationRequest): Promise<LocationDto> {
    const updateValues: Partial<typeof locations.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException('Location name cannot be empty');
      }
      updateValues.name = name;
    }

    if (dto.timezone !== undefined) {
      updateValues.timezone = this.validateTimezone(dto.timezone);
    }

    if (dto.currency !== undefined) {
      updateValues.currency = this.validateCurrency(dto.currency);
    }

    const [updated] = await db
      .update(locations)
      .set(updateValues)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.active, true)))
      .returning();

    if (!updated) {
      throw new NotFoundException('Active location not found for tenant');
    }

    return this.mapLocationToDto(updated);
  }
}
