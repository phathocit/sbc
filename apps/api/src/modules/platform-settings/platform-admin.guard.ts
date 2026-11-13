import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(@Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    if (typeof userId !== 'string') throw new UnauthorizedException('Authenticated user is required');
    await this.settings.assertAdmin(userId);
    return true;
  }
}
