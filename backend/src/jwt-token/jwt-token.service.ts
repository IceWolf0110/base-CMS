import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuthSession } from '../auth/entities/auth-session.entity.js';
import { LessThan, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { User } from '../users/entities/user.entity.js';
import { IssuedTokens, JwtPayload } from '../auth/auth.types.js';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as argon2 from 'argon2';

const DEFAULT_REFRESH_TTL = '1d';
const MAX_SESSIONS = 5; // optional: remove along with the cleanup block below

@Injectable()
export class JwtTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,

    @InjectRepository(AuthSession)
    private readonly authSessionRepository: Repository<AuthSession>,
  ) {}

  async verifyRefreshToken(
    token: string,
  ): Promise<JwtPayload & { jti: string }> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      if (!payload.jti) throw new Error('missing jti');
      return payload as JwtPayload & { jti: string };
    } catch {
      throw new UnauthorizedException('Access denied');
    }
  }

  async issueTokens(
    user: User,
    rememberMe: boolean,
  ): Promise<IssuedTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const refreshTtl = (
      rememberMe
        ? this.config.getOrThrow<string>('JWT_REFRESH_TTL')
        : DEFAULT_REFRESH_TTL
    ) as JwtSignOptions['expiresIn'];

    const tokenId = randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      // secret + expiresIn come from JwtModule
      this.jwtService.signAsync(payload),
      // refresh token overrides them
      this.jwtService.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshTtl,
        jwtid: tokenId,
      }),
    ]);

    const accessExp = this.jwtService.decode<{ exp: number }>(accessToken).exp;
    const refreshExp = this.jwtService.decode<{ exp: number }>(
      refreshToken,
    ).exp;
    const refreshExpiresAt = new Date(refreshExp * 1000);

    // Housekeeping: drop this user's expired sessions
    await this.authSessionRepository.delete({
      userId: user.id,
      expiresAt: LessThan(new Date()),
    });

    await this.authSessionRepository.save({
      id: tokenId,
      userId: user.id,
      tokenHash: await this.hashToken(refreshToken),
      expiresAt: refreshExpiresAt,
      rememberMe,
    });

    // Optional: keep only the newest MAX_SESSIONS sessions
    const sessions = await this.authSessionRepository.find({
      where: { userId: user.id },
      select: { id: true },
      order: { createdAt: 'DESC' },
    });
    const stale = sessions.slice(MAX_SESSIONS).map((s) => s.id);
    if (stale.length) {
      await this.authSessionRepository.delete(stale);
    }

    return {
      accessToken,
      refreshToken,
      accessExpiresAt: new Date(accessExp * 1000),
      refreshExpiresAt,
      rememberMe,
    };
  }

  async hashMatches(
    storedHash: string,
    token: string,
  ): Promise<boolean> {
    try {
      return await argon2.verify(storedHash, token);
    } catch {
      return false;
    }
  }

  private async hashToken(token: string): Promise<string> {
    return argon2.hash(token);
  }
}
