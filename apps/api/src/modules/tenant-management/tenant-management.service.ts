import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type {
  CompleteTenantInvitationRequest,
  ClaimTenantInvitationRequest,
  CreateTenantRequest,
  CreateTenantApplicationRequest,
  PlatformNotificationDto,
  PlatformTenantDetailDto,
  PlatformTenantDto,
  PublicTenantApplicationRequest,
  ReviewTenantApplicationRequest,
  TenantApplicationDto,
  TenantApplicationStatus,
  TenantStatus,
  UpdateTenantStatusRequest,
} from '@sbc/contracts';
import type { User } from '@sbc/database';
import { and, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { bookings, outboxMessages, platformAdminAuditEvents, platformNotificationReads, publicRateLimits, services, staffProfiles, tenantApplications, tenantOwnerInvitations, tenants, memberships, locations, tenantPolicies, users, planCatalog, tenantSubscriptions, tenantBookingUsage, tenantPlanChanges } from '../../../../../packages/database/dist/schema/index.js';
import { db } from '../../database';
import { PasswordService } from '../../common/crypto/password.service';
import { systemSettingsMasterKey } from '../platform-settings/system-settings.crypto';

@Injectable()
export class TenantManagementService {
  constructor(@Inject(PasswordService) private readonly passwords: PasswordService) {}

  private validateTenantDetails(dto: CreateTenantRequest) {
    if (!dto || typeof dto !== 'object') throw new BadRequestException('Thông tin đăng ký không hợp lệ.');
    const slug = typeof dto.slug === 'string' ? dto.slug.trim().toLowerCase() : '';
    if (!slug || slug.length < 3 || slug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new BadRequestException('Slug phải dài 3–63 ký tự, chỉ gồm chữ thường, số và dấu gạch nối đơn.');
    }
    const name = typeof dto.name === 'string' ? dto.name.trim() : '';
    if (!name || name.length > 255) throw new BadRequestException('Tên tenant là bắt buộc và tối đa 255 ký tự.');
    if (dto.timezone !== undefined && typeof dto.timezone !== 'string') throw new BadRequestException('Múi giờ không hợp lệ.');
    const timezone = dto.timezone?.trim() || 'Asia/Ho_Chi_Minh';
    try { new Intl.DateTimeFormat(undefined, { timeZone: timezone }); }
    catch { throw new BadRequestException('Múi giờ không hợp lệ.'); }
    if (dto.currency !== undefined && typeof dto.currency !== 'string') throw new BadRequestException('Mã tiền tệ không hợp lệ.');
    const currency = (dto.currency?.trim() || 'VND').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('Mã tiền tệ phải gồm 3 chữ cái.');
    return { name, slug, timezone, currency };
  }

  private isUniqueViolation(error: unknown): boolean {
    const visited = new Set<object>();
    let current: unknown = error;
    while (typeof current === 'object' && current !== null && !visited.has(current)) {
      visited.add(current);
      const wrapped = current as { code?: unknown; cause?: unknown };
      if (wrapped.code === '23505') return true;
      current = wrapped.cause;
    }
    return false;
  }

  private mapApplication(
    application: typeof tenantApplications.$inferSelect,
    applicantName: string,
    applicantEmail: string,
  ): TenantApplicationDto {
    return {
      id: application.id,
      applicantUserId: application.applicantUserId,
      applicantName,
      applicantEmail,
      contactPhone: application.contactPhone,
      serviceType: application.serviceType,
      requestedPlan: application.requestedPlan,
      name: application.name,
      slug: application.slug,
      timezone: application.timezone,
      currency: application.currency,
      status: application.status as TenantApplicationStatus,
      reviewNote: application.reviewNote,
      reviewedAt: application.reviewedAt?.toISOString() ?? null,
      tenantId: application.tenantId,
      createdAt: application.createdAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
    };
  }

  async submitApplication(user: User, dto: CreateTenantApplicationRequest): Promise<TenantApplicationDto> {
    const details = this.validateTenantDetails(dto);
    const [existingTenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, details.slug)).limit(1);
    if (existingTenant) throw new ConflictException('Đường dẫn này đã được sử dụng. Hãy chọn slug khác.');
    try {
      const application = await db.transaction(async (tx) => {
        const [created] = await tx.insert(tenantApplications).values({
          applicantUserId: user.id, applicantName: user.displayName, applicantEmail: user.email,
          contactPhone: 'Chưa cung cấp', serviceType: 'Chưa cung cấp', requestedPlan: 'free', ...details,
        }).returning();
        await tx.insert(outboxMessages).values({
          eventType: 'platform.tenant_application.submitted', tenantId: null,
          payload: { applicationId: created.id, name: created.name, slug: created.slug },
        });
        await tx.execute(sql`select pg_notify('platform_notifications', 'changed')`);
        return created;
      });
      return this.mapApplication(application, user.displayName, user.email);
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('Bạn đã có hồ sơ đang chờ duyệt hoặc slug này đang được đăng ký.');
      throw error;
    }
  }

  private normalizeApplication(dto: PublicTenantApplicationRequest) {
    const applicantName = typeof dto?.applicantName === 'string' ? dto.applicantName.trim() : '';
    const applicantEmail = typeof dto?.applicantEmail === 'string' ? dto.applicantEmail.trim().toLowerCase() : '';
    const contactPhone = typeof dto?.contactPhone === 'string' ? dto.contactPhone.trim() : '';
    const serviceType = typeof dto?.serviceType === 'string' ? dto.serviceType.trim() : '';
    const requestedPlan = dto?.requestedPlan;
    const name = typeof dto?.name === 'string' ? dto.name.trim() : '';
    if (!applicantName || applicantName.length > 255) throw new BadRequestException('Tên chủ tiệm không hợp lệ.');
    if (applicantEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicantEmail)) throw new BadRequestException('Email không hợp lệ.');
    if (!contactPhone || contactPhone.length > 32 || !/^[+\d][\d\s().-]{7,30}$/.test(contactPhone)) throw new BadRequestException('Số điện thoại không hợp lệ.');
    if (!serviceType || serviceType.length > 120) throw new BadRequestException('Loại hình dịch vụ không hợp lệ.');
    if (typeof requestedPlan !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,23}$/.test(requestedPlan)) throw new BadRequestException('Gói dịch vụ không hợp lệ.');
    if (!name || name.length > 255) throw new BadRequestException('Tên tiệm không hợp lệ.');
    const baseSlug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replaceAll(String.fromCharCode(273), 'd').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 52) || 'tiem-dich-vu';
    const slug = `${baseSlug}-${randomBytes(3).toString('hex')}`;
    return { applicantName, applicantEmail, contactPhone, serviceType, requestedPlan, name, slug, timezone: 'Asia/Ho_Chi_Minh', currency: 'VND' };
  }

  private applicationRateKey(): Buffer {
    const value = process.env.APP_CONFIG_MASTER_KEY?.trim() ?? '';
    if (!/^[0-9a-f]{64}$/i.test(value)) throw new ServiceUnavailableException('System configuration is unavailable.');
    return createHmac('sha256', Buffer.from(value, 'hex')).update('tenant-application-rate-limit-v1').digest();
  }

  private async enforceApplicationRateLimit(request: Request): Promise<void> {
    const address = request.socket.remoteAddress;
    if (!address || address.length > 128) throw new BadRequestException('Không xác định được kết nối.');
    const now = Date.now();
    const windowStart = new Date(Math.floor(now / 60_000) * 60_000);
    const keyHash = createHmac('sha256', this.applicationRateKey())
      .update(`tenant-application:${address}`).digest('hex');
    const [row] = await db.insert(publicRateLimits).values({ keyHash, windowStart, requestCount: 1 })
      .onConflictDoUpdate({
        target: [publicRateLimits.keyHash, publicRateLimits.windowStart],
        set: { requestCount: sql`${publicRateLimits.requestCount} + 1` },
      }).returning({ requestCount: publicRateLimits.requestCount });
    if (row && row.requestCount > 5) throw new HttpException('Vui lòng thử lại sau một phút.', HttpStatus.TOO_MANY_REQUESTS);
    await db.delete(publicRateLimits).where(lt(publicRateLimits.createdAt, new Date(now - 48 * 60 * 60_000)));
  }

  async submitPublicApplication(dto: PublicTenantApplicationRequest, request: Request): Promise<{ accepted: true }> {
    const application = this.normalizeApplication(dto);
    await this.enforceApplicationRateLimit(request);
    const [requestedPlan] = await db.select({ id: planCatalog.id }).from(planCatalog).where(and(eq(planCatalog.code, application.requestedPlan), eq(planCatalog.isActive, true))).limit(1);
    if (!requestedPlan) throw new BadRequestException('Gói được chọn hiện không còn khả dụng. Vui lòng tải lại trang.');
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('tenant-application-email:' || ${application.applicantEmail}, 0))`);
        const [existingUser] = await tx.select({ id: users.id, accountStatus: users.accountStatus }).from(users)
          .where(sql`lower(${users.email}) = ${application.applicantEmail}`).limit(1).for('update');
        if (existingUser?.accountStatus === 'active') {
          throw new ConflictException('Email này đã có tài khoản ZenBook. Vui lòng dùng email khác hoặc đăng nhập bằng tài khoản hiện có.');
        }
        const [existingApplication] = await tx.select({ id: tenantApplications.id }).from(tenantApplications)
          .where(and(
            sql`lower(${tenantApplications.applicantEmail}) = ${application.applicantEmail}`,
            or(
              eq(tenantApplications.status, 'pending'),
              sql`${tenantApplications.status} = 'approved' AND EXISTS (
                SELECT 1 FROM tenant_owner_invitations
                WHERE tenant_owner_invitations.application_id = ${tenantApplications.id}
                  AND tenant_owner_invitations.used_at IS NULL
                  AND tenant_owner_invitations.revoked_at IS NULL
                  AND tenant_owner_invitations.expires_at > now()
              )`,
            ),
          )).limit(1);
        if (existingApplication) {
          throw new ConflictException('Email này đã có hồ sơ đăng ký hoặc lời mời đang chờ xử lý. Vui lòng chờ kết quả hoặc liên hệ hỗ trợ.');
        }
        const [created] = await tx.insert(tenantApplications).values({
          applicantUserId: existingUser?.id ?? null,
          applicantName: application.applicantName, applicantEmail: application.applicantEmail,
          contactPhone: application.contactPhone, serviceType: application.serviceType,
          requestedPlan: application.requestedPlan, name: application.name, slug: application.slug,
          timezone: application.timezone, currency: application.currency,
        }).returning({ id: tenantApplications.id, name: tenantApplications.name, slug: tenantApplications.slug });
        await tx.insert(outboxMessages).values({
          eventType: 'platform.tenant_application.submitted', tenantId: null,
          payload: { applicationId: created.id, name: created.name, slug: created.slug },
        });
        await tx.execute(sql`select pg_notify('platform_notifications', 'changed')`);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const [existingUser] = await db.select({ id: users.id, accountStatus: users.accountStatus }).from(users)
          .where(sql`lower(${users.email}) = ${application.applicantEmail}`).limit(1);
        if (existingUser?.accountStatus === 'active') {
          throw new ConflictException('Email này đã có tài khoản ZenBook. Vui lòng dùng email khác hoặc đăng nhập bằng tài khoản hiện có.');
        }
        const [existingApplication] = await db.select({ id: tenantApplications.id }).from(tenantApplications)
          .where(and(
            sql`lower(${tenantApplications.applicantEmail}) = ${application.applicantEmail}`,
            or(
              eq(tenantApplications.status, 'pending'),
              sql`${tenantApplications.status} = 'approved' AND EXISTS (
                SELECT 1 FROM tenant_owner_invitations
                WHERE tenant_owner_invitations.application_id = ${tenantApplications.id}
                  AND tenant_owner_invitations.used_at IS NULL
                  AND tenant_owner_invitations.revoked_at IS NULL
                  AND tenant_owner_invitations.expires_at > now()
              )`,
            ),
          )).limit(1);
        if (existingApplication) {
          throw new ConflictException('Email này đã có hồ sơ đăng ký hoặc lời mời đang chờ xử lý. Vui lòng chờ kết quả hoặc liên hệ hỗ trợ.');
        }
        // Keep the existing generic response for an unexpected slug collision.
        return { accepted: true };
      }
      throw error;
    }
    return { accepted: true };
  }

  async getMyApplication(userId: string): Promise<TenantApplicationDto | null> {
    const [application] = await db.select().from(tenantApplications)
      .where(eq(tenantApplications.applicantUserId, userId))
      .orderBy(desc(tenantApplications.createdAt))
      .limit(1);
    return application ? this.mapApplication(application, application.applicantName, application.applicantEmail) : null;
  }

  async listApplications(): Promise<TenantApplicationDto[]> {
    const rows = await db.select().from(tenantApplications)
      .orderBy(desc(tenantApplications.createdAt));
    return rows.map((application) => this.mapApplication(application, application.applicantName, application.applicantEmail));
  }

  async reviewApplication(applicationId: string, reviewerId: string, dto: ReviewTenantApplicationRequest): Promise<TenantApplicationDto> {
    if (!dto || (dto.decision !== 'approve' && dto.decision !== 'reject')) throw new BadRequestException('Quyết định phải là approve hoặc reject.');
    if (dto.note !== undefined && typeof dto.note !== 'string') throw new BadRequestException('Ghi chú không hợp lệ.');
    const note = dto.note?.trim() || null;
    if (note && note.length > 1000) throw new BadRequestException('Ghi chú tối đa 1.000 ký tự.');
    if (dto.decision === 'reject' && (!note || note.length < 10)) throw new BadRequestException('Cần ghi rõ lý do từ chối, tối thiểu 10 ký tự.');

    try {
      return await db.transaction(async (tx) => {
        const [application] = await tx.select().from(tenantApplications)
          .where(eq(tenantApplications.id, applicationId)).limit(1).for('update');
        if (!application) throw new NotFoundException('Không tìm thấy hồ sơ đăng ký tenant.');
        if (application.status !== 'pending') throw new ConflictException('Hồ sơ này đã được xử lý.');
        const reviewedAt = new Date();

        if (dto.decision === 'reject') {
          const [updated] = await tx.update(tenantApplications).set({
            status: 'rejected', reviewedBy: reviewerId, reviewedAt, reviewNote: note, updatedAt: reviewedAt,
          }).where(and(eq(tenantApplications.id, applicationId), eq(tenantApplications.status, 'pending'))).returning();
          await tx.insert(outboxMessages).values({
            eventType: 'platform.tenant_application.reviewed', tenantId: null,
            payload: { applicationId: application.id, name: application.name, slug: application.slug, decision: 'rejected' },
          });
          await tx.insert(outboxMessages).values({ eventType: 'tenant_application.rejected_email.requested', tenantId: null,
            payload: { recipient: application.applicantEmail, recipientName: application.applicantName, tenantName: application.name, reason: note } });
          await tx.insert(platformAdminAuditEvents).values({ actorUserId: reviewerId, entityType: 'application', entityId: application.id,
            action: 'application.rejected', before: { status: 'pending' }, after: { status: 'rejected' }, reason: note });
          await tx.execute(sql`select pg_notify('platform_notifications', 'changed')`);
          return this.mapApplication(updated, application.applicantName, application.applicantEmail);
        }

        const [existingTenant] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, application.slug)).limit(1);
        if (existingTenant) throw new ConflictException('Slug đã được tenant khác sử dụng; hãy từ chối hồ sơ để người đăng ký gửi slug mới.');

        const [applicant] = application.applicantUserId
          ? await tx.select().from(users).where(eq(users.id, application.applicantUserId)).limit(1).for('update')
          : await tx.select().from(users).where(sql`lower(${users.email}) = ${application.applicantEmail.toLowerCase()}`).limit(1).for('update');
        if (applicant && applicant.email.toLowerCase() !== application.applicantEmail.toLowerCase()) {
          throw new ConflictException('Tài khoản người đăng ký không khớp email trong hồ sơ.');
        }
        const applicantAccount = applicant ?? (await tx.insert(users).values({
          email: application.applicantEmail.toLowerCase(),
          displayName: application.applicantName,
          accountStatus: 'pending_activation',
          passwordHash: null,
        }).returning())[0];

        const [tenant] = await tx.insert(tenants).values({ slug: application.slug, displayName: application.name, status: 'active' }).returning();
        const [freePlan] = await tx.select().from(planCatalog).where(and(eq(planCatalog.code, 'free'), eq(planCatalog.isActive, true))).orderBy(desc(planCatalog.version)).limit(1);
        if (!freePlan) throw new ServiceUnavailableException('Free plan catalog is not initialized; apply migration 0008');
        const periodStart = reviewedAt;
        const periodEnd = new Date(periodStart);
        const day = periodEnd.getUTCDate();
        periodEnd.setUTCDate(1);
        periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
        periodEnd.setUTCDate(Math.min(day, new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 1, 0)).getUTCDate()));
        await tx.insert(tenantSubscriptions).values({ tenantId: tenant.id, planId: freePlan.id, status: 'active', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd });
        if (applicantAccount.accountStatus === 'active') {
          await tx.insert(memberships).values({ tenantId: tenant.id, userId: applicantAccount.id, role: 'owner', status: 'active' });
        }
        await tx.insert(locations).values({
          tenantId: tenant.id, name: 'Main Location', timezone: application.timezone, currency: application.currency, active: true,
        });
        await tx.insert(tenantPolicies).values({
          tenantId: tenant.id, confirmationMode: 'AUTO', pendingExpiryMinutes: 120,
          cancellationCutoffMinutes: 1440, rescheduleCutoffMinutes: 1440, minLeadMinutes: 60,
          bookingHorizonDays: 30, slotIntervalMinutes: 15, version: 1,
        });
        const [updated] = await tx.update(tenantApplications).set({
          applicantUserId: applicantAccount.id, status: 'approved', reviewedBy: reviewerId, reviewedAt, reviewNote: note,
          tenantId: tenant.id, updatedAt: reviewedAt,
        }).where(and(eq(tenantApplications.id, applicationId), eq(tenantApplications.status, 'pending'))).returning();
        await tx.insert(platformAdminAuditEvents).values({ actorUserId: reviewerId, tenantId: tenant.id, entityType: 'application', entityId: application.id,
          action: 'application.approved', before: { status: 'pending' }, after: { status: 'approved', tenantId: tenant.id, requestedPlan: application.requestedPlan }, reason: note });
        await tx.insert(outboxMessages).values({
          eventType: 'platform.tenant_application.reviewed', tenantId: tenant.id,
          payload: { applicationId: application.id, tenantId: tenant.id, name: application.name, slug: application.slug, decision: 'approved' },
        });
        await tx.execute(sql`select pg_notify('platform_notifications', 'changed')`);
        if (applicantAccount.accountStatus === 'active') {
          await tx.insert(outboxMessages).values({
            eventType: 'tenant_application.approved_email.requested', tenantId: tenant.id,
            payload: { recipient: application.applicantEmail, recipientName: application.applicantName, tenantName: application.name, tenantSlug: application.slug },
          });
        } else {
          const token = randomBytes(32).toString('base64url');
          const iv = randomBytes(12);
          const cipher = createCipheriv('aes-256-gcm', systemSettingsMasterKey(), iv);
          const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ recipient: application.applicantEmail, recipientName: application.applicantName, tenantName: application.name, tenantSlug: application.slug, token }), 'utf8'), cipher.final()]);
          await tx.insert(tenantOwnerInvitations).values({
            applicationId: application.id, tenantId: tenant.id, tokenHash: createHash('sha256').update(token).digest('hex'),
            expiresAt: new Date(reviewedAt.getTime() + 48 * 60 * 60_000),
          });
          await tx.insert(outboxMessages).values({
            eventType: 'tenant_owner_invitation.requested', tenantId: tenant.id,
            payload: { encryption: 'aes-256-gcm-v1', iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') },
          });
        }
        return this.mapApplication(updated, application.applicantName, application.applicantEmail);
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('Slug hoặc hồ sơ đã được xử lý đồng thời. Tải lại danh sách rồi thử lại.');
      throw error;
    }
  }

  async completeOwnerInvitation(dto: CompleteTenantInvitationRequest, request: Request): Promise<{ completed: true }> {
    const token = typeof dto?.token === 'string' ? dto.token : '';
    const password = typeof dto?.password === 'string' ? dto.password : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException('Lời mời không hợp lệ hoặc đã hết hạn.');
    await this.enforceApplicationRateLimit(request);
    if (password.length < 12 || password.length > 128) throw new BadRequestException('Mật khẩu phải dài từ 12 đến 128 ký tự.');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const passwordHash = await this.passwords.hashPassword(password);
    try {
      await db.transaction(async (tx) => {
        const [invitation] = await tx.select().from(tenantOwnerInvitations)
          .where(eq(tenantOwnerInvitations.tokenHash, tokenHash)).limit(1).for('update');
        const now = new Date();
        if (!invitation || invitation.usedAt || invitation.revokedAt || invitation.expiresAt <= now) {
          throw new UnauthorizedException('Lời mời không hợp lệ hoặc đã hết hạn.');
        }
        const [application] = await tx.select().from(tenantApplications)
          .where(eq(tenantApplications.id, invitation.applicationId)).limit(1);
        if (!application || application.status !== 'approved' || application.tenantId !== invitation.tenantId) {
          throw new UnauthorizedException('Lời mời không hợp lệ hoặc đã hết hạn.');
        }
        const [tenant] = await tx.select({ id: tenants.id, status: tenants.status }).from(tenants)
          .where(eq(tenants.id, invitation.tenantId)).limit(1);
        if (!tenant || tenant.status !== 'active') throw new UnauthorizedException('Lời mời không hợp lệ hoặc đã hết hạn.');
        const [existingUser] = application.applicantUserId
          ? await tx.select().from(users).where(eq(users.id, application.applicantUserId)).limit(1).for('update')
          : await tx.select().from(users).where(sql`lower(${users.email}) = ${application.applicantEmail.toLowerCase()}`).limit(1).for('update');
        if (existingUser && existingUser.email.toLowerCase() !== application.applicantEmail.toLowerCase()) {
          throw new UnauthorizedException('Lời mời không hợp lệ hoặc đã hết hạn.');
        }
        if (existingUser?.accountStatus === 'active') {
          throw new ConflictException('Tài khoản đã được kích hoạt. Hãy đăng nhập bằng tài khoản đó để nhận quyền chủ tiệm.');
        }
        const [activatedUser] = existingUser
          ? await tx.update(users).set({
            passwordHash, accountStatus: 'active', displayName: application.applicantName, updatedAt: now,
          }).where(eq(users.id, existingUser.id)).returning({ id: users.id })
          : await tx.insert(users).values({
            email: application.applicantEmail, displayName: application.applicantName,
            passwordHash, accountStatus: 'active',
          }).returning({ id: users.id });
        await tx.insert(memberships).values({ tenantId: tenant.id, userId: activatedUser.id, role: 'owner', status: 'active' });
        await tx.update(tenantApplications).set({ applicantUserId: activatedUser.id, updatedAt: now })
          .where(eq(tenantApplications.id, application.id));
        await tx.update(tenantOwnerInvitations).set({ usedAt: now }).where(and(
          eq(tenantOwnerInvitations.id, invitation.id), eq(tenantOwnerInvitations.tokenHash, tokenHash),
        ));
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('Email này đã có tài khoản. Hãy đăng nhập bằng tài khoản hiện có hoặc liên hệ hỗ trợ.');
      throw error;
    }
    return { completed: true };
  }

  async claimOwnerInvitation(user: User, dto: ClaimTenantInvitationRequest, request: Request): Promise<{ completed: true; tenantId: string }> {
    const token = typeof dto?.token === 'string' ? dto.token : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException('Invitation is invalid or expired.');
    await this.enforceApplicationRateLimit(request);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return db.transaction(async (tx) => {
      const [invitation] = await tx.select().from(tenantOwnerInvitations)
        .where(eq(tenantOwnerInvitations.tokenHash, tokenHash)).limit(1).for('update');
      const now = new Date();
      if (!invitation || invitation.usedAt || invitation.revokedAt || invitation.expiresAt <= now) {
        throw new UnauthorizedException('Invitation is invalid or expired.');
      }
      const [application] = await tx.select().from(tenantApplications)
        .where(eq(tenantApplications.id, invitation.applicationId)).limit(1);
      if (!application || application.status !== 'approved' || application.tenantId !== invitation.tenantId
        || application.applicantEmail !== user.email.toLowerCase()) {
        throw new UnauthorizedException('Invitation is invalid or expired.');
      }
      const [tenant] = await tx.select({ id: tenants.id, status: tenants.status }).from(tenants)
        .where(eq(tenants.id, invitation.tenantId)).limit(1);
      if (!tenant || tenant.status !== 'active') throw new UnauthorizedException('Invitation is invalid or expired.');
      await tx.insert(memberships).values({ tenantId: tenant.id, userId: user.id, role: 'owner', status: 'active' });
      await tx.update(tenantApplications).set({ applicantUserId: user.id, updatedAt: now })
        .where(eq(tenantApplications.id, application.id));
      await tx.update(tenantOwnerInvitations).set({ usedAt: now }).where(eq(tenantOwnerInvitations.id, invitation.id));
      return { completed: true as const, tenantId: tenant.id };
    });
  }

  async listTenants(): Promise<PlatformTenantDto[]> {
    const rows = await db.select({
      id: tenants.id, slug: tenants.slug, displayName: tenants.displayName, status: tenants.status,
      createdAt: tenants.createdAt, updatedAt: tenants.updatedAt,
      ownerName: users.displayName, ownerEmail: users.email,
    }).from(tenants)
      .leftJoin(memberships, and(eq(memberships.tenantId, tenants.id), eq(memberships.role, 'owner'), eq(memberships.status, 'active')))
      .leftJoin(users, eq(users.id, memberships.userId))
      .orderBy(desc(tenants.createdAt));
    const subscriptionRows = await db.select({ tenantId: tenantSubscriptions.tenantId, periodEnd: tenantSubscriptions.currentPeriodEnd,
      planName: planCatalog.displayName, bookingLimit: planCatalog.monthlyBookingLimit, periodStart: tenantSubscriptions.currentPeriodStart,
    }).from(tenantSubscriptions).innerJoin(planCatalog, eq(tenantSubscriptions.planId, planCatalog.id));
    const subscriptionsByTenant = new Map(subscriptionRows.map((row) => [row.tenantId, row]));
    const usageRows = await db.select({ tenantId: tenantBookingUsage.tenantId, periodStart: tenantBookingUsage.periodStart,
      bookings: tenantBookingUsage.bookingCount }).from(tenantBookingUsage)
      .innerJoin(tenantSubscriptions, and(eq(tenantBookingUsage.tenantId, tenantSubscriptions.tenantId),
        eq(tenantBookingUsage.periodStart, tenantSubscriptions.currentPeriodStart)));
    const usagesByPeriod = new Map(usageRows.map((row) => [`${row.tenantId}:${row.periodStart.toISOString()}`, row.bookings]));
    return rows.map((row) => ({
      id: row.id, slug: row.slug, displayName: row.displayName, status: row.status as TenantStatus,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      ownerName: row.ownerName, ownerEmail: row.ownerEmail,
      currentPlanName: subscriptionsByTenant.get(row.id)?.planName ?? null,
      planPeriodEnd: subscriptionsByTenant.get(row.id)?.periodEnd.toISOString() ?? null,
      bookingUsage: subscriptionsByTenant.get(row.id) ? usagesByPeriod.get(`${row.id}:${subscriptionsByTenant.get(row.id)!.periodStart.toISOString()}`) ?? 0 : null,
      bookingLimit: subscriptionsByTenant.get(row.id)?.bookingLimit ?? null,
    }));
  }

  async getTenantDetail(tenantId: string): Promise<PlatformTenantDetailDto> {
    const [tenant] = await db.select({
      id: tenants.id, slug: tenants.slug, displayName: tenants.displayName, status: tenants.status,
      createdAt: tenants.createdAt, updatedAt: tenants.updatedAt,
      ownerName: users.displayName, ownerEmail: users.email,
      locationName: locations.name, timezone: locations.timezone, currency: locations.currency,
    }).from(tenants)
      .leftJoin(memberships, and(eq(memberships.tenantId, tenants.id), eq(memberships.role, 'owner'), eq(memberships.status, 'active')))
      .leftJoin(users, eq(users.id, memberships.userId))
      .leftJoin(locations, and(eq(locations.tenantId, tenants.id), eq(locations.active, true)))
      .where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new NotFoundException('Khong tim thay tenant.');
    const [staff, service, booking, staffRows, serviceRows, billingRows, historyRows, activeStaffUsage, statusEvents] = await Promise.all([
      db.select({ value: count() }).from(staffProfiles).where(eq(staffProfiles.tenantId, tenantId)),
      db.select({ value: count() }).from(services).where(eq(services.tenantId, tenantId)),
      db.select({ value: count() }).from(bookings).where(eq(bookings.tenantId, tenantId)),
      db.select({ name: staffProfiles.name, active: staffProfiles.active }).from(staffProfiles).where(eq(staffProfiles.tenantId, tenantId)).orderBy(desc(staffProfiles.createdAt)),
      db.select({ name: services.name, durationMinutes: services.durationMinutes, priceMinor: services.priceMinor, currency: services.currency, active: services.active }).from(services).where(eq(services.tenantId, tenantId)).orderBy(desc(services.createdAt)),
      db.select({ subscription: tenantSubscriptions, plan: planCatalog }).from(tenantSubscriptions).innerJoin(planCatalog, eq(tenantSubscriptions.planId, planCatalog.id)).where(eq(tenantSubscriptions.tenantId, tenantId)).limit(1),
      db.select({ change: tenantPlanChanges, fromPlan: planCatalog.displayName }).from(tenantPlanChanges).leftJoin(planCatalog, eq(tenantPlanChanges.fromPlanId, planCatalog.id)).where(eq(tenantPlanChanges.tenantId, tenantId)).orderBy(desc(tenantPlanChanges.changedAt)).limit(20),
      db.select({ value: count() }).from(staffProfiles).where(and(eq(staffProfiles.tenantId, tenantId), eq(staffProfiles.active, true))),
      db.select({ payload: outboxMessages.payload, occurredAt: outboxMessages.occurredAt }).from(outboxMessages)
        .where(and(eq(outboxMessages.tenantId, tenantId), eq(outboxMessages.eventType, 'platform.tenant_status.changed')))
        .orderBy(desc(outboxMessages.occurredAt)).limit(20),
    ]);
    const currentBilling = billingRows[0];
    const usage = currentBilling ? await db.select().from(tenantBookingUsage).where(and(
      eq(tenantBookingUsage.tenantId, tenantId), eq(tenantBookingUsage.periodStart, currentBilling.subscription.currentPeriodStart),
    )).limit(1) : [];
    const planIds = [...new Set(historyRows.map((row) => row.change.toPlanId))];
    const changedToPlans = planIds.length ? await db.select({ id: planCatalog.id, name: planCatalog.displayName }).from(planCatalog).where(inArray(planCatalog.id, planIds)) : [];
    const planNames = new Map(changedToPlans.map((row) => [row.id, row.name]));
    const statusActors = statusEvents.map((event) => (event.payload as Record<string, unknown> | null)?.actorUserId).filter((id): id is string => typeof id === 'string');
    const [approvedApplication] = await db.select().from(tenantApplications).where(and(eq(tenantApplications.tenantId, tenantId), eq(tenantApplications.status, 'approved'))).orderBy(desc(tenantApplications.reviewedAt)).limit(1);
    const [invitation] = approvedApplication ? await db.select().from(tenantOwnerInvitations).where(eq(tenantOwnerInvitations.applicationId, approvedApplication.id)).orderBy(desc(tenantOwnerInvitations.expiresAt)).limit(1) : [];
    const [invitationDelivery] = approvedApplication ? await db.select({ processedAt: outboxMessages.processedAt,
      deadLetteredAt: outboxMessages.deadLetteredAt, failureReason: outboxMessages.failureReason }).from(outboxMessages)
      .where(and(eq(outboxMessages.tenantId, tenantId), eq(outboxMessages.eventType, 'tenant_owner_invitation.requested')))
      .orderBy(desc(outboxMessages.occurredAt)).limit(1) : [];
    const actorIds = [...new Set([...statusActors, ...historyRows.map((row) => row.change.actorUserId).filter((id): id is string => Boolean(id)), ...(approvedApplication?.reviewedBy ? [approvedApplication.reviewedBy] : [])])];
    const actorRows = actorIds.length ? await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, actorIds)) : [];
    const actorNames = new Map(actorRows.map((row) => [row.id, row.name]));
    const [ownerAccount] = approvedApplication?.applicantUserId ? await db.select({ accountStatus: users.accountStatus }).from(users).where(eq(users.id, approvedApplication.applicantUserId)).limit(1) : [];
    return {
      id: tenant.id, slug: tenant.slug, displayName: tenant.displayName, status: tenant.status as TenantStatus,
      createdAt: tenant.createdAt.toISOString(), updatedAt: tenant.updatedAt.toISOString(),
      ownerName: tenant.ownerName, ownerEmail: tenant.ownerEmail,
      locationName: tenant.locationName, timezone: tenant.timezone, currency: tenant.currency,
      staffProfileCount: Number(staff[0]?.value ?? 0), serviceCount: Number(service[0]?.value ?? 0), bookingCount: Number(booking[0]?.value ?? 0),
      billing: currentBilling ? {
        plan: { id: currentBilling.plan.id, code: currentBilling.plan.code, version: currentBilling.plan.version, displayName: currentBilling.plan.displayName,
          priceVnd: currentBilling.plan.priceVnd, currency: 'VND', activeStaffLimit: currentBilling.plan.activeStaffLimit, monthlyBookingLimit: currentBilling.plan.monthlyBookingLimit,
          sortOrder: currentBilling.plan.sortOrder, features: Array.isArray(currentBilling.plan.features) ? currentBilling.plan.features : [] },
        status: currentBilling.subscription.status as 'active' | 'past_due' | 'expired', periodStart: currentBilling.subscription.currentPeriodStart.toISOString(),
        periodEnd: currentBilling.subscription.currentPeriodEnd.toISOString(), usage: { activeStaff: Number(activeStaffUsage[0]?.value ?? 0), bookings: usage[0]?.bookingCount ?? 0, bookingLimit: currentBilling.plan.monthlyBookingLimit },
      } : null,
      planChanges: historyRows.map(({ change, fromPlan }) => ({ fromPlan, toPlan: planNames.get(change.toPlanId) ?? 'Gói đã lưu trữ', note: change.note,
        changedAt: change.changedAt.toISOString(), changeType: change.changeType, actorName: change.actorUserId ? actorNames.get(change.actorUserId) ?? 'Quản trị viên' : 'Hệ thống' })),
      onboarding: approvedApplication ? { applicantEmail: approvedApplication.applicantEmail,
        requestedPlanName: (await db.select({ name: planCatalog.displayName }).from(planCatalog).where(eq(planCatalog.code, approvedApplication.requestedPlan)).orderBy(desc(planCatalog.version)).limit(1))[0]?.name ?? approvedApplication.requestedPlan,
        reviewedAt: approvedApplication.reviewedAt?.toISOString() ?? null,
        reviewerName: approvedApplication.reviewedBy ? actorNames.get(approvedApplication.reviewedBy) ?? 'Quản trị viên' : null,
        invitationStatus: !invitation ? (ownerAccount?.accountStatus === 'active' ? 'not_required' : 'missing') : invitation.usedAt ? 'used' : invitation.revokedAt ? 'revoked' : invitation.expiresAt <= new Date() ? 'expired' : 'pending',
        ownerAccountStatus: ownerAccount?.accountStatus ?? null,
        invitationDeliveryStatus: !invitationDelivery ? null : invitationDelivery.processedAt ? 'sent' : invitationDelivery.deadLetteredAt ? 'failed' : 'queued',
        invitationDeliveryError: invitationDelivery?.failureReason ?? null,
      } : null,
      statusChanges: statusEvents.map((event) => { const payload = event.payload as Record<string, unknown> | null; return {
        from: String(payload?.previousStatus ?? ''), to: String(payload?.status ?? ''), reason: String(payload?.reason ?? ''),
        actorName: actorNames.get(String(payload?.actorUserId ?? '')) ?? 'Quản trị viên', changedAt: event.occurredAt.toISOString(),
      }; }),
      staffProfiles: staffRows, services: serviceRows,
    };
  }

  async listNotifications(userId: string): Promise<PlatformNotificationDto[]> {
    const rows = await db.select().from(outboxMessages)
      .where(inArray(outboxMessages.eventType, [
        'platform.tenant_application.submitted', 'platform.tenant_application.reviewed', 'platform.tenant_status.changed',
        'platform.support_ticket.created', 'platform.support_ticket.replied', 'platform.billing.review_required',
        'platform.billing.payment_paid', 'platform.billing.payment_failed',
      ]))
      .orderBy(desc(outboxMessages.occurredAt)).limit(50);
    const readRows = rows.length ? await db.select({ notificationId: platformNotificationReads.notificationId })
      .from(platformNotificationReads)
      .where(and(eq(platformNotificationReads.userId, userId), inArray(platformNotificationReads.notificationId, rows.map((row) => row.id)))) : [];
    const readIds = new Set(readRows.map((row) => row.notificationId));
    return rows.flatMap((row): PlatformNotificationDto[] => {
      if (!row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) return [];
      const payload = row.payload as Record<string, unknown>;
      if (row.eventType === 'platform.tenant_application.submitted' && typeof payload.name === 'string' && typeof payload.slug === 'string') {
        return [{ id: row.id, type: 'tenant_application_submitted', title: 'Hồ sơ tenant mới', description: `${payload.name} · /${payload.slug} đang chờ duyệt.`, occurredAt: row.occurredAt.toISOString(), isRead: readIds.has(row.id), tenantId: null, applicationId: typeof payload.applicationId === 'string' ? payload.applicationId : null }];
      }
      if (row.eventType === 'platform.tenant_application.reviewed' && typeof payload.name === 'string' && typeof payload.slug === 'string' && (payload.decision === 'approved' || payload.decision === 'rejected')) {
        const approved = payload.decision === 'approved';
        return [{ id: row.id, type: 'tenant_application_reviewed', title: approved ? 'Tenant đã được duyệt' : 'Hồ sơ đã bị từ chối', description: `${payload.name} · /${payload.slug}`, occurredAt: row.occurredAt.toISOString(), isRead: readIds.has(row.id), tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : null, applicationId: typeof payload.applicationId === 'string' ? payload.applicationId : null }];
      }
      if (row.eventType === 'platform.tenant_status.changed') return [{ id: row.id, type: 'tenant_status_changed', title: payload.status === 'suspended' ? 'Tenant tạm ngưng' : 'Tenant hoạt động lại',
        description: `${String(payload.name ?? 'Tenant')} · ${String(payload.reason ?? '')}`, occurredAt: row.occurredAt.toISOString(), isRead: readIds.has(row.id),
        tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : row.tenantId, applicationId: null }];
      if (row.eventType === 'platform.support_ticket.created' || row.eventType === 'platform.support_ticket.replied') return [{ id: row.id,
        type: row.eventType === 'platform.support_ticket.created' ? 'support_ticket_created' : 'support_ticket_replied',
        title: row.eventType === 'platform.support_ticket.created' ? 'Ticket hỗ trợ mới' : 'Tenant trả lời ticket',
        description: String(payload.title ?? payload.subject ?? 'Yêu cầu hỗ trợ cần xem'), occurredAt: row.occurredAt.toISOString(), isRead: readIds.has(row.id),
        tenantId: row.tenantId, applicationId: null, ticketId: typeof payload.ticketId === 'string' ? payload.ticketId : null }];
      if (row.eventType === 'platform.billing.review_required') return [{ id: row.id, type: 'billing_review_required', title: 'Thanh toán cần xử lý',
        description: `Đơn ${String(payload.orderId ?? '').slice(0, 8)} · ${String(payload.provider ?? '').toUpperCase()}`, occurredAt: row.occurredAt.toISOString(), isRead: readIds.has(row.id),
        tenantId: row.tenantId, applicationId: null, orderId: typeof payload.orderId === 'string' ? payload.orderId : null }];
      if (row.eventType === 'platform.billing.payment_paid' || row.eventType === 'platform.billing.payment_failed') return [{ id: row.id,
        type: row.eventType === 'platform.billing.payment_paid' ? 'billing_payment_paid' : 'billing_payment_failed',
        title: row.eventType === 'platform.billing.payment_paid' ? 'Thanh toán thành công' : 'Thanh toán thất bại',
        description: `${String(payload.planName ?? 'Gói dịch vụ')} · ${String(payload.provider ?? '').toUpperCase()} · ${Number(payload.amountVnd ?? 0).toLocaleString('vi-VN')} đ`,
        occurredAt: row.occurredAt.toISOString(), isRead: readIds.has(row.id), tenantId: row.tenantId, applicationId: null,
        orderId: typeof payload.orderId === 'string' ? payload.orderId : null }];
      return [];
    });
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<{ read: true }> {
    const [notification] = await db.select({ id: outboxMessages.id }).from(outboxMessages).where(and(
      eq(outboxMessages.id, notificationId),
      inArray(outboxMessages.eventType, ['platform.tenant_application.submitted', 'platform.tenant_application.reviewed', 'platform.tenant_status.changed',
        'platform.support_ticket.created', 'platform.support_ticket.replied', 'platform.billing.review_required', 'platform.billing.payment_paid', 'platform.billing.payment_failed']),
    )).limit(1);
    if (!notification) throw new NotFoundException('Không tìm thấy thông báo.');
    await db.insert(platformNotificationReads).values({ userId, notificationId }).onConflictDoNothing();
    return { read: true };
  }

  async updateTenantStatus(tenantId: string, actor: User, dto: UpdateTenantStatusRequest): Promise<PlatformTenantDto> {
    if (!dto || (dto.status !== 'active' && dto.status !== 'suspended')) throw new BadRequestException('Trạng thái tenant không hợp lệ.');
    const reason = typeof dto.reason === 'string' ? dto.reason.trim() : '';
    if (reason.length < 10 || reason.length > 500) throw new BadRequestException('Lý do phải dài từ 10 đến 500 ký tự.');
    if (typeof dto.currentPassword !== 'string' || !actor.passwordHash || !await this.passwords.verifyPassword(dto.currentPassword, actor.passwordHash)) {
      throw new UnauthorizedException('Mật khẩu quản trị không chính xác.');
    }
    const tenant = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update').limit(1);
      if (!current) throw new NotFoundException('Không tìm thấy tenant.');
      if (current.status === dto.status) throw new ConflictException('Trạng thái tenant đã được cập nhật. Hãy tải lại danh sách.');
      const [updated] = await tx.update(tenants).set({ status: dto.status, updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning();
      await tx.insert(platformAdminAuditEvents).values({ actorUserId: actor.id, tenantId, entityType: 'tenant', entityId: tenantId,
        action: 'tenant.status_changed', before: { status: current.status }, after: { status: dto.status }, reason });
      await tx.insert(outboxMessages).values({ eventType: 'platform.tenant_status.changed', tenantId,
        payload: { tenantId, name: updated.displayName, slug: updated.slug, status: dto.status, reason, actorUserId: actor.id, previousStatus: current.status } });
      await tx.execute(sql`select pg_notify('platform_notifications', 'changed')`);
      return updated;
    });
    if (!tenant) throw new NotFoundException('Không tìm thấy tenant.');
    const [owner] = await db.select({ name: users.displayName, email: users.email }).from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, tenant.id), eq(memberships.role, 'owner'), eq(memberships.status, 'active')))
      .limit(1);
    return {
      id: tenant.id, slug: tenant.slug, displayName: tenant.displayName, status: tenant.status as TenantStatus,
      createdAt: tenant.createdAt.toISOString(), updatedAt: tenant.updatedAt.toISOString(),
      ownerName: owner?.name ?? null, ownerEmail: owner?.email ?? null,
    };
  }

  async resendOwnerInvitation(tenantId: string, actor: User, currentPassword: string): Promise<{ queued: true }> {
    if (typeof currentPassword !== 'string' || !actor.passwordHash || !await this.passwords.verifyPassword(currentPassword, actor.passwordHash)) {
      throw new UnauthorizedException('Mật khẩu quản trị không chính xác.');
    }
    await db.transaction(async (tx) => {
      const [tenant] = await tx.select({ id: tenants.id, status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId)).for('update').limit(1);
      if (!tenant) throw new NotFoundException('Không tìm thấy tenant.');
      if (tenant.status !== 'active') throw new ConflictException('Cần kích hoạt tenant trước khi gửi lời mời.');
      const [application] = await tx.select().from(tenantApplications).where(and(eq(tenantApplications.tenantId, tenantId), eq(tenantApplications.status, 'approved'))).orderBy(desc(tenantApplications.reviewedAt)).limit(1);
      if (!application) throw new ConflictException('Tenant này không có hồ sơ đăng ký đã duyệt.');
      const [account] = application.applicantUserId ? await tx.select({ accountStatus: users.accountStatus }).from(users).where(eq(users.id, application.applicantUserId)).limit(1) : [];
      if (account?.accountStatus === 'active') throw new ConflictException('Tài khoản chủ tiệm đã kích hoạt.');
      const [invitation] = await tx.select().from(tenantOwnerInvitations).where(eq(tenantOwnerInvitations.applicationId, application.id)).for('update').limit(1);
      const now = new Date();
      if (invitation?.usedAt) throw new ConflictException('Lời mời đã được sử dụng.');
      if (invitation && now.getTime() - invitation.createdAt.getTime() < 5 * 60_000) throw new HttpException('Chỉ có thể gửi lại sau 5 phút.', HttpStatus.TOO_MANY_REQUESTS);
      const [delivery] = await tx.select({ processedAt: outboxMessages.processedAt, deadLetteredAt: outboxMessages.deadLetteredAt }).from(outboxMessages)
        .where(and(eq(outboxMessages.tenantId, tenantId), eq(outboxMessages.eventType, 'tenant_owner_invitation.requested')))
        .orderBy(desc(outboxMessages.occurredAt)).limit(1);
      if (delivery && !delivery.processedAt && !delivery.deadLetteredAt) throw new ConflictException('Email lời mời trước vẫn đang chờ gửi hoặc thử lại. Hãy kiểm tra worker trước.');
      const token = randomBytes(32).toString('base64url');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', systemSettingsMasterKey(), iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ recipient: application.applicantEmail, recipientName: application.applicantName,
        tenantName: application.name, tenantSlug: application.slug, token }), 'utf8'), cipher.final()]);
      const expiresAt = new Date(now.getTime() + 48 * 60 * 60_000);
      if (invitation) await tx.update(tenantOwnerInvitations).set({ tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt, revokedAt: null, usedAt: null, createdAt: now }).where(eq(tenantOwnerInvitations.id, invitation.id));
      else await tx.insert(tenantOwnerInvitations).values({ applicationId: application.id, tenantId,
        tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt });
      await tx.insert(outboxMessages).values({ eventType: 'tenant_owner_invitation.requested', tenantId,
        payload: { encryption: 'aes-256-gcm-v1', iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') } });
      await tx.insert(platformAdminAuditEvents).values({ actorUserId: actor.id, tenantId, entityType: 'tenant', entityId: tenantId,
        action: 'tenant.invitation_resent', after: { applicationId: application.id, expiresAt: expiresAt.toISOString() } });
    });
    return { queued: true };
  }
}
