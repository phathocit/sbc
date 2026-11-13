import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthAccessContext, AuthResponse, AuthUser, LoginRequest, RegisterRequest } from '@sbc/contracts';
import type { User } from '@sbc/database';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { authSessions, platformAdmins, users } from '../../../../../packages/database/dist/schema/index.js';
import { db } from '../../database';
import { JwtService } from '../../common/crypto/jwt.service';
import { PasswordService } from '../../common/crypto/password.service';

export interface AuthSessionTokens {
  response: AuthResponse;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

const ACCESS_TTL_MS = 10 * 60_000;
const ADMIN_IDLE_TTL_MS = 8 * 60 * 60_000;
const ADMIN_ABSOLUTE_TTL_MS = 24 * 60 * 60_000;
const TENANT_IDLE_TTL_MS = 7 * 24 * 60 * 60_000;
const TENANT_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60_000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PasswordService) private readonly passwordService: PasswordService,
    @Inject(JwtService) private readonly jwtService: JwtService,
  ) {}

  private mapUserToDto(user: User): AuthUser {
    return { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt.toISOString() };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issueSession(user: User): Promise<AuthSessionTokens> {
    const [admin] = await db.select({ userId: platformAdmins.userId }).from(platformAdmins)
      .where(eq(platformAdmins.userId, user.id)).limit(1);
    const sessionType = admin ? 'platform_admin' : 'tenant';
    const now = new Date();
    const absoluteExpiresAt = new Date(now.getTime() + (admin ? ADMIN_ABSOLUTE_TTL_MS : TENANT_ABSOLUTE_TTL_MS));
    const idleExpiresAt = new Date(Math.min(now.getTime() + (admin ? ADMIN_IDLE_TTL_MS : TENANT_IDLE_TTL_MS), absoluteExpiresAt.getTime()));
    const sessionId = randomUUID();
    const refreshToken = this.jwtService.sign({ sub: user.id, sid: sessionId, jti: randomBytes(32).toString('base64url') }, 'refresh', absoluteExpiresAt);
    const accessExpiresAt = new Date(now.getTime() + ACCESS_TTL_MS);
    const accessToken = this.jwtService.sign({ sub: user.id, sid: sessionId, jti: randomBytes(16).toString('base64url') }, 'access', accessExpiresAt);
    await db.insert(authSessions).values({
      id: sessionId, userId: user.id, sessionType, refreshTokenHash: this.hashToken(refreshToken),
      lastActivityAt: now, idleExpiresAt, absoluteExpiresAt,
    });
    return { response: { user: this.mapUserToDto(user) }, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt: absoluteExpiresAt };
  }

  async register(dto: RegisterRequest): Promise<AuthSessionTokens> {
    const email = dto.email?.trim().toLowerCase();
    if (!email || !email.includes('@')) throw new BadRequestException('A valid email address is required');
    if (!dto.password || dto.password.length < 8) throw new BadRequestException('Password must be at least 8 characters long');
    const displayName = dto.displayName?.trim();
    if (!displayName) throw new BadRequestException('Display name is required');

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new ConflictException({ statusCode: 409, errorCode: 'EMAIL_ALREADY_EXISTS', message: 'A user with this email address already exists' });
    const passwordHash = await this.passwordService.hashPassword(dto.password);
    const [newUser] = await db.insert(users).values({ email, passwordHash, accountStatus: 'active', displayName }).returning();
    return this.issueSession(newUser);
  }

  async login(dto: LoginRequest, previousRefreshToken?: string): Promise<AuthSessionTokens> {
    const email = dto.email?.trim().toLowerCase();
    if (!email || !dto.password) throw new UnauthorizedException({ statusCode: 401, errorCode: 'INVALID_CREDENTIALS', message: 'Email and password are required' });
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || user.accountStatus !== 'active' || !user.passwordHash || !(await this.passwordService.verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException({ statusCode: 401, errorCode: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }
    if (previousRefreshToken) await this.revokeByRefreshToken(previousRefreshToken);
    return this.issueSession(user);
  }

  async refresh(presentedToken: string, userActive: boolean): Promise<AuthSessionTokens> {
    let claims;
    try { claims = this.jwtService.verify(presentedToken, 'refresh'); }
    catch { throw new UnauthorizedException('Refresh session is invalid or expired'); }

    const result = await db.transaction(async (tx) => {
      const [session] = await tx.select().from(authSessions).where(eq(authSessions.id, claims.sid)).for('update').limit(1);
      if (!session || session.revokedAt) return { failure: 'invalid' as const };
      const presentedHash = this.hashToken(presentedToken);
      if (session.userId !== claims.sub || session.refreshTokenHash !== presentedHash) {
        await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.id, session.id), isNull(authSessions.revokedAt)));
        return { failure: 'replay' as const };
      }
      const now = new Date();
      if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) {
        await tx.update(authSessions).set({ revokedAt: now }).where(eq(authSessions.id, session.id));
        return { failure: 'expired' as const };
      }
      const [user] = await tx.select().from(users).where(eq(users.id, session.userId)).limit(1);
      if (!user || user.accountStatus !== 'active' || !user.passwordHash) {
        await tx.update(authSessions).set({ revokedAt: now }).where(eq(authSessions.id, session.id));
        return { failure: 'invalid' as const };
      }
      const [admin] = await tx.select({ userId: platformAdmins.userId }).from(platformAdmins).where(eq(platformAdmins.userId, user.id)).limit(1);
      if (Boolean(admin) !== (session.sessionType === 'platform_admin')) {
        await tx.update(authSessions).set({ revokedAt: now }).where(eq(authSessions.id, session.id));
        return { failure: 'invalid' as const };
      }
      const nextRefreshToken = this.jwtService.sign({ sub: user.id, sid: session.id, jti: randomBytes(32).toString('base64url') }, 'refresh', session.absoluteExpiresAt);
      const accessExpiresAt = new Date(now.getTime() + ACCESS_TTL_MS);
      const accessToken = this.jwtService.sign({ sub: user.id, sid: session.id, jti: randomBytes(16).toString('base64url') }, 'access', accessExpiresAt);
      const idleLimit = session.sessionType === 'platform_admin' ? ADMIN_IDLE_TTL_MS : TENANT_IDLE_TTL_MS;
      const idleExpiresAt = userActive
        ? new Date(Math.min(now.getTime() + idleLimit, session.absoluteExpiresAt.getTime()))
        : session.idleExpiresAt;
      await tx.update(authSessions).set({
        refreshTokenHash: this.hashToken(nextRefreshToken), lastActivityAt: userActive ? now : session.lastActivityAt, idleExpiresAt,
      }).where(eq(authSessions.id, session.id));
      return {
        tokens: { response: { user: this.mapUserToDto(user) }, accessToken, refreshToken: nextRefreshToken,
          accessExpiresAt, refreshExpiresAt: session.absoluteExpiresAt },
      };
    });
    if ('failure' in result) throw new UnauthorizedException(result.failure === 'replay' ? 'Refresh token reuse detected; sign in again' : 'Refresh session is invalid or expired');
    return result.tokens;
  }

  async revokeByRefreshToken(token?: string): Promise<void> {
    if (!token) return;
    let claims;
    try { claims = this.jwtService.verify(token, 'refresh'); } catch { return; }
    const now = new Date();
    await db.update(authSessions).set({ revokedAt: now }).where(and(
      eq(authSessions.id, claims.sid), eq(authSessions.userId, claims.sub), eq(authSessions.refreshTokenHash, this.hashToken(token)),
    ));
  }

  async getMe(userId: string): Promise<AuthUser> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new UnauthorizedException('User not found');
    return this.mapUserToDto(user);
  }

  async getAccessContext(userId: string): Promise<AuthAccessContext> {
    const [admin] = await db.select({ userId: platformAdmins.userId }).from(platformAdmins)
      .where(eq(platformAdmins.userId, userId)).limit(1);
    return { platformAdmin: Boolean(admin) };
  }
}
