import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { SchedulingController } from './scheduling.controller';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [CatalogController, SchedulingController],
  providers: [CatalogService],
})
export class CatalogModule {}
