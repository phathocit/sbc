import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateMembershipRequest,
  MembershipDto,
  MembershipRole,
  MembershipStatus,
  UpdateMembershipRequest,
} from '@sbc/contracts';
import {
  memberships,
  users,
} from '../../../../../packages/database/dist/schema/index.js';
import { and, count, eq } from 'drizzle-orm';
import { db } from '../../database';

@Injectable()
export class MembershipsService {
  private readonly validRoles: MembershipRole[] = [
    'owner',
    'admin',
    'receptionist',
    'staff',
  ];

  private readonly validStatuses: MembershipStatus[] = [
    'active',
    'invited',
    'suspended',
  ];

  async listMembers(tenantId: string): Promise<MembershipDto[]> {
    // Tenant isolation: always filter by tenantId
    const rows = await db
      .select({
        membership: memberships,
        user: {
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          createdAt: users.createdAt,
        },
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.tenantId, tenantId));

    return rows.map((r) => ({
      id: r.membership.id,
      tenantId: r.membership.tenantId,
      userId: r.membership.userId,
      role: r.membership.role as MembershipRole,
      status: r.membership.status as MembershipStatus,
      createdAt: r.membership.createdAt.toISOString(),
      updatedAt: r.membership.updatedAt.toISOString(),
      user: {
        id: r.user.id,
        email: r.user.email,
        displayName: r.user.displayName,
        createdAt: r.user.createdAt.toISOString(),
      },
    }));
  }

  async addMember(
    tenantId: string,
    dto: CreateMembershipRequest,
  ): Promise<MembershipDto> {
    const email = dto.email?.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('User email is required');
    }

    if (!this.validRoles.includes(dto.role)) {
      throw new BadRequestException(
        `Invalid role. Must be one of: ${this.validRoles.join(', ')}`,
      );
    }

    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!targetUser) {
      throw new NotFoundException({
        statusCode: 404,
        errorCode: 'USER_NOT_FOUND',
        message: `No registered user found with email '${email}'. The user must register first.`,
      });
    }

    // Check if membership already exists in this tenant
    const [existing] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.userId, targetUser.id),
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictException({
        statusCode: 409,
        errorCode: 'MEMBERSHIP_ALREADY_EXISTS',
        message: 'This user is already a member of this tenant organization',
      });
    }

    const [created] = await db
      .insert(memberships)
      .values({
        tenantId,
        userId: targetUser.id,
        role: dto.role,
        status: 'active',
      })
      .returning();

    return {
      id: created.id,
      tenantId: created.tenantId,
      userId: created.userId,
      role: created.role as MembershipRole,
      status: created.status as MembershipStatus,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
      user: {
        id: targetUser.id,
        email: targetUser.email,
        displayName: targetUser.displayName,
        createdAt: targetUser.createdAt.toISOString(),
      },
    };
  }

  async updateMember(
    tenantId: string,
    membershipId: string,
    dto: UpdateMembershipRequest,
  ): Promise<MembershipDto> {
    // Tenant isolation: composite lookup by tenantId and membershipId
    const [current] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.id, membershipId),
        ),
      )
      .limit(1);

    if (!current) {
      throw new NotFoundException('Membership record not found in this tenant');
    }

    if (dto.role && !this.validRoles.includes(dto.role)) {
      throw new BadRequestException(
        `Invalid role. Must be one of: ${this.validRoles.join(', ')}`,
      );
    }

    if (dto.status && !this.validStatuses.includes(dto.status)) {
      throw new BadRequestException(
        `Invalid status. Must be one of: ${this.validStatuses.join(', ')}`,
      );
    }

    // Invariant: Last owner cannot be demoted or deactivated
    if (
      current.role === 'owner' &&
      ((dto.role && dto.role !== 'owner') ||
        (dto.status && dto.status !== 'active'))
    ) {
      const [ownerCount] = await db
        .select({ value: count() })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, tenantId),
            eq(memberships.role, 'owner'),
            eq(memberships.status, 'active'),
          ),
        );

      if (Number(ownerCount.value) <= 1) {
        throw new BadRequestException({
          statusCode: 400,
          errorCode: 'LAST_OWNER_PROTECTION',
          message: 'Cannot demote or deactivate the last active owner of the tenant',
        });
      }
    }

    const updateValues: Partial<typeof memberships.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (dto.role) updateValues.role = dto.role;
    if (dto.status) updateValues.status = dto.status;

    const [updated] = await db
      .update(memberships)
      .set(updateValues)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.id, membershipId),
        ),
      )
      .returning();

    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, updated.userId))
      .limit(1);

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      userId: updated.userId,
      role: updated.role as MembershipRole,
      status: updated.status as MembershipStatus,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      user: targetUser
        ? {
            id: targetUser.id,
            email: targetUser.email,
            displayName: targetUser.displayName,
            createdAt: targetUser.createdAt.toISOString(),
          }
        : undefined,
    };
  }

  async removeMember(
    tenantId: string,
    membershipId: string,
  ): Promise<{ success: boolean }> {
    // Tenant isolation: composite lookup by tenantId and membershipId
    const [current] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.id, membershipId),
        ),
      )
      .limit(1);

    if (!current) {
      throw new NotFoundException('Membership record not found in this tenant');
    }

    // Invariant: Last owner cannot be removed
    if (current.role === 'owner') {
      const [ownerCount] = await db
        .select({ value: count() })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, tenantId),
            eq(memberships.role, 'owner'),
            eq(memberships.status, 'active'),
          ),
        );

      if (Number(ownerCount.value) <= 1) {
        throw new BadRequestException({
          statusCode: 400,
          errorCode: 'LAST_OWNER_PROTECTION',
          message: 'Cannot remove the last active owner of the tenant',
        });
      }
    }

    await db
      .delete(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.id, membershipId),
        ),
      );

    return { success: true };
  }
}
