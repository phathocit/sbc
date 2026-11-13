import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { PublicBookingController } from './public-booking.controller';
import { PublicBookingService } from './public-booking.service';

@Module({
  imports: [BookingModule, PlatformSettingsModule],
  controllers: [PublicBookingController],
  providers: [PublicBookingService],
})
export class PublicBookingModule {}
