export interface RefreshCookie {
  refreshToken: string;
  refreshExpiresAt: Date;
  rememberMe: boolean;
}