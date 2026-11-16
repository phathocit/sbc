import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PlatformAdminGuard } from '../platform-settings/platform-admin.guard';
import { PlatformOperationsService } from './platform-operations.service';

@Controller('platform/operations')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class PlatformOperationsController {
  constructor(@Inject(PlatformOperationsService) private readonly operations: PlatformOperationsService) {}
  @Get('overview') overview() { return this.operations.overview(); }
  @Get('audit') audit(@Query('page') page?: string, @Query('entityType') entityType?: string) {
    return this.operations.audit(Number(page ?? 1), entityType && /^(application|tenant|plan|billing|settings|telegram|support)$/.test(entityType) ? entityType : undefined);
  }
}
