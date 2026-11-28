import { UserRole } from '../users/entities/user.entity.js';

export interface JwtPayload {
  sub: number;
  email: string;
  role: UserRole;
  jti?: string;
}

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  rememberMe: boolean;
}