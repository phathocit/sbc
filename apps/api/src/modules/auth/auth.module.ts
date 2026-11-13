import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '../../common/crypto/jwt.service';
import { PasswordService } from '../../common/crypto/password.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [ConfigModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, JwtService, AuthGuard],
  exports: [AuthService, PasswordService, JwtService, AuthGuard],
})
export class AuthModule {}
