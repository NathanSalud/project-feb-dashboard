import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (config: ConfigService) => ({
        secret:      config.get('JWT_SECRET') as string,
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') as string },
      }),
      inject: [ConfigService],
    }),
  ],
  providers:   [AuthService],
  controllers: [AuthController],
  exports:     [AuthService, JwtModule],
})
export class AuthModule {}
