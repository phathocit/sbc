import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Inject, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthAccessContext, AuthResponse, AuthUser, LoginRequest, RegisterRequest } from '@sbc/contracts';
import type { User } from '@sbc/database';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AuthService, AuthSessionTokens } from './auth.service';

const ACCESS_COOKIE = 'sbc_access';
const REFRESH_COOKIE = 'sbc_refresh';
const isProduction = () => process.env.NODE_ENV === 'production';
const webOrigins = () => (process.env.WEB_ORIGINS || 'http://localhost:3002').split(',').map((value) => value.trim()).filter(Boolean);

function readCookie(request: Request, name: string): string | undefined {
  const raw = request.headers.cookie;
  return raw?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function assertBrowserRequest(request: Request): void {
  if (typeof request.headers.origin !== 'string' || !webOrigins().includes(request.headers.origin)
    || request.headers['x-sbc-request'] !== '1') {
    throw new ForbiddenException('Invalid or missing browser request origin');
  }
}

function setSessionCookies(response: Response, tokens: AuthSessionTokens): void {
  const common = { httpOnly: true, secure: isProduction(), sameSite: 'lax' as const };
  response.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...common, path: '/', expires: tokens.accessExpiresAt,
  });
  response.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...common, path: '/v1/auth', expires: tokens.refreshExpiresAt,
  });
}

function clearSessionCookies(response: Response): void {
  const common = { httpOnly: true, secure: isProduction(), sameSite: 'lax' as const };
  response.clearCookie(ACCESS_COOKIE, { ...common, path: '/' });
  response.clearCookie(REFRESH_COOKIE, { ...common, path: '/v1/auth' });
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterRequest, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<AuthResponse> {
    assertBrowserRequest(request);
    const tokens = await this.authService.register(dto);
    setSessionCookies(response, tokens);
    return tokens.response;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginRequest, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<AuthResponse> {
    assertBrowserRequest(request);
    const tokens = await this.authService.login(dto, readCookie(request, REFRESH_COOKIE));
    setSessionCookies(response, tokens);
    return tokens.response;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<AuthResponse> {
    assertBrowserRequest(request);
    const refreshToken = readCookie(request, REFRESH_COOKIE);
    if (!refreshToken) throw new UnauthorizedException('Refresh session is missing');
    const tokens = await this.authService.refresh(refreshToken, request.headers['x-sbc-user-active'] === '1');
    setSessionCookies(response, tokens);
    return tokens.response;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    assertBrowserRequest(request);
    await this.authService.revokeByRefreshToken(readCookie(request, REFRESH_COOKIE));
    clearSessionCookies(response);
  }

  @UseGuards(AuthGuard)
  @Get('me')
  async me(@CurrentUser() user: User): Promise<AuthUser> { return this.authService.getMe(user.id); }

  @UseGuards(AuthGuard)
  @Get('access')
  async access(@CurrentUser() user: User): Promise<AuthAccessContext> { return this.authService.getAccessContext(user.id); }
}
