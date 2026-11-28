import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { UsersModule } from '../users/users.module.js';
import { CookiesModule } from '../cookies/cookies.module.js';
import { JwtTokenModule } from '../jwt-token/jwt-token.module.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity.js';
import { AuthSession } from '../auth/entities/auth-session.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AuthSession]),
    UsersModule,
    CookiesModule,
    JwtTokenModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
