import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type AuthTokenType = 'access' | 'refresh';
export interface AuthJwtPayload {
  sub: string;
  sid: string;
  jti: string;
  typ: AuthTokenType;
  iss: 'service-business-cloud';
  aud: 'sbc-api';
  iat: number;
  exp: number;
}

@Injectable()
export class JwtService {
  private readonly masterSecret: string;

  constructor(@Optional() private readonly configService?: ConfigService) {
    this.masterSecret = this.configService?.get<string>('JWT_SECRET')
      || process.env.JWT_SECRET
      || 'dev-jwt-secret-min-32-characters-long-service-business-cloud';
  }

  private secret(type: AuthTokenType): Buffer {
    return createHmac('sha256', this.masterSecret).update(`sbc-auth-${type}-v1`).digest();
  }

  private encode(data: string | Buffer): string {
    return Buffer.isBuffer(data) ? data.toString('base64url') : Buffer.from(data).toString('base64url');
  }

  sign(payload: Omit<AuthJwtPayload, 'iss' | 'aud' | 'iat' | 'exp' | 'typ'>, type: AuthTokenType, expiresAt: Date): string {
    const now = Math.floor(Date.now() / 1000);
    const fullPayload: AuthJwtPayload = {
      ...payload,
      typ: type,
      iss: 'service-business-cloud',
      aud: 'sbc-api',
      iat: now,
      exp: Math.floor(expiresAt.getTime() / 1000),
    };
    const header = this.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = this.encode(JSON.stringify(fullPayload));
    const content = `${header}.${body}`;
    const signature = createHmac('sha256', this.secret(type)).update(content).digest('base64url');
    return `${content}.${signature}`;
  }

  verify(token: string, expectedType: AuthTokenType): AuthJwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Invalid token format');
    const [headerEncoded, bodyEncoded, signatureEncoded] = parts;
    let header: unknown;
    let payload: unknown;
    try {
      header = JSON.parse(Buffer.from(headerEncoded, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(bodyEncoded, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Invalid token payload');
    }
    if (!header || typeof header !== 'object' || (header as Record<string, unknown>).alg !== 'HS256'
      || (header as Record<string, unknown>).typ !== 'JWT') {
      throw new UnauthorizedException('Invalid token header');
    }
    const expected = createHmac('sha256', this.secret(expectedType)).update(`${headerEncoded}.${bodyEncoded}`).digest();
    const provided = Buffer.from(signatureEncoded, 'base64url');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new UnauthorizedException('Invalid token signature');
    }
    if (!payload || typeof payload !== 'object') throw new UnauthorizedException('Invalid token payload');
    const claims = payload as Partial<AuthJwtPayload>;
    if (claims.typ !== expectedType || claims.iss !== 'service-business-cloud' || claims.aud !== 'sbc-api'
      || typeof claims.sub !== 'string' || typeof claims.sid !== 'string' || typeof claims.jti !== 'string'
      || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) {
      throw new UnauthorizedException('Invalid token claims');
    }
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp! <= now || claims.iat! > now + 60) throw new UnauthorizedException('Token has expired or is not yet valid');
    return claims as AuthJwtPayload;
  }
}
