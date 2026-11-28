import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service.js';
import { UserDto } from '../users/dto/user.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { AuthSession } from './entities/auth-session.entity.js';
import { JwtTokenService } from '../jwt-token/jwt-token.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtTokenService: JwtTokenService,
    @InjectRepository(AuthSession)
    private readonly authSessionRepository: Repository<AuthSession>,
  ) {}

  async register(dto: UserDto) {
    const created = await this.usersService.create(dto);
    const user = await this.usersService.findOne(created.id);
    return this.jwtTokenService.issueTokens(user, false);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findUserPasswordByEmail(dto.email);

    if (!user || !(await argon2.verify(user.password, dto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.jwtTokenService.issueTokens(user, dto.rememberMe === true);
  }

  async refresh(token: string | undefined) {
    if (!token) throw new UnauthorizedException('Access denied');

    const payload = await this.jwtTokenService.verifyRefreshToken(token);

    const stored = await this.authSessionRepository.findOneBy({
      id: payload.jti,
      userId: payload.sub,
    });

    if (!stored || !(await this.jwtTokenService.hashMatches(stored.tokenHash, token))) {
      throw new UnauthorizedException('Access denied');
    }

    // Rotate: single-use. The affected check stops two concurrent refreshes
    // from both succeeding with the same token.
    const result = await this.authSessionRepository.delete({
      id: payload.jti,
    });
    if (!result.affected) {
      throw new UnauthorizedException('Access denied');
    }

    const user = await this.usersService.findOne(payload.sub);
    return this.jwtTokenService.issueTokens(user, stored.rememberMe); // keep the session type
  }

  async logout(token: string | undefined) {
    if (token) {
      try {
        const payload = await this.jwtTokenService.verifyRefreshToken(token);
        await this.authSessionRepository.delete({
          id: payload.jti,
          userId: payload.sub,
        });
      } catch {
        // invalid or expired token: nothing to revoke, cookie still gets cleared
      }
    }
    return { message: 'Logged out' };
  }

  async logoutAll(userId: number) {
    await this.authSessionRepository.delete({ userId });
    return { message: 'Logged out from all devices' };
  }
}
