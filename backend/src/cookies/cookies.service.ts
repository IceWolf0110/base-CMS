import { CookieSerializeOptions, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { REFRESH_COOKIE } from './cookies.constants.js';
import type { RefreshCookie } from './cookies.types.js';

@Injectable()
export class CookiesService {
  private readonly base: CookieSerializeOptions;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    config: ConfigService,
  ) {
    this.base = {
      httpOnly: true,
      secure: config.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/auth', // only sent to /auth/*
    };
  }

  setRefresh(res: unknown, t: RefreshCookie) {
    this.adapterHost.httpAdapter.setCookie(
      res,
      REFRESH_COOKIE,
      t.refreshToken,
      {
        ...this.base,
        // no expiry => session cookie when rememberMe is false
        ...(t.rememberMe ? { expires: t.refreshExpiresAt } : {}),
      },
    );
  }

  clearRefresh(res: unknown) {
    // path must match the one used when setting
    this.adapterHost.httpAdapter.clearCookie(res, REFRESH_COOKIE, this.base);
  }
}
