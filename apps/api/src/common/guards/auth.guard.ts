import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { authSessions, platformAdmins, users } from '../../../../../packages/database/dist/schema/index.js';
import { db } from '../../database';
import { JwtService } from '../crypto/jwt.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

function cookieValue(header: string | undefined, name: string): string | undefined {
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function allowedWebOrigins(): string[] {
  return (process.env.WEB_ORIGINS || 'http://localhost:3002').split(',').map((origin) => origin.trim()).filter(Boolean);
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  private assertBrowserRequest(request: any): void {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !allowedWebOrigins().includes(origin) || request.headers['x-sbc-request'] !== '1') {
      throw new ForbiddenException('Invalid or missing browser request origin');
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const request = context.switchToHttp().getRequest();
    const token = cookieValue(request.headers.cookie, 'sbc_access');
    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Authentication session is required');
    }
    this.assertBrowserRequest(request);

    let claims;
    try { claims = this.jwtService.verify(token, 'access'); }
    catch (error) {
      if (isPublic) return true;
      throw new UnauthorizedException(error instanceof Error ? error.message : 'Invalid access session');
    }

    const now = new Date();
    const [session] = await db.select().from(authSessions).where(eq(authSessions.id, claims.sid)).limit(1);
    if (!session || session.userId !== claims.sub || session.revokedAt || session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) {
      if (!isPublic) throw new UnauthorizedException('Authentication session has expired or was revoked');
      return true;
    }
    const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
    if (!user || user.accountStatus !== 'active' || !user.passwordHash) {
      if (user) await db.update(authSessions).set({ revokedAt: now }).where(and(eq(authSessions.id, session.id), isNull(authSessions.revokedAt)));
      if (!isPublic) throw new UnauthorizedException('Account is not activated or no longer exists');
      return true;
    }
    const [admin] = await db.select({ userId: platformAdmins.userId }).from(platformAdmins).where(eq(platformAdmins.userId, user.id)).limit(1);
    if (Boolean(admin) !== (session.sessionType === 'platform_admin')) {
      await db.update(authSessions).set({ revokedAt: now }).where(and(eq(authSessions.id, session.id), isNull(authSessions.revokedAt)));
      if (!isPublic) throw new UnauthorizedException('Account access changed; sign in again');
      return true;
    }

    if (request.headers['x-sbc-user-active'] === '1' && session.lastActivityAt.getTime() <= now.getTime() - 5 * 60_000) {
      const idleLimit = session.sessionType === 'platform_admin' ? 8 * 60 * 60_000 : 7 * 24 * 60 * 60_000;
      const idleExpiresAt = new Date(Math.min(now.getTime() + idleLimit, session.absoluteExpiresAt.getTime()));
      await db.update(authSessions).set({ lastActivityAt: now, idleExpiresAt }).where(and(
        eq(authSessions.id, session.id), isNull(authSessions.revokedAt), lte(authSessions.lastActivityAt, new Date(now.getTime() - 5 * 60_000)),
      ));
    }
    request.user = user;
    request.authSession = session;
    return true;
  }
}
