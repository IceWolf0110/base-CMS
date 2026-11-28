import { Body, Controller, Cookies, HttpCode, Post, Res } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { CookiesService } from '../cookies/cookies.service.js';
import { REFRESH_COOKIE } from '../cookies/cookies.constants.js';
import { UserDto } from '../users/dto/user.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { CurrentUser, Public } from '../jwt-token/decorators.js';
import type { AuthUser, IssuedTokens } from './auth.types.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookies: CookiesService,
  ) {}

  // refresh token -> cookie, access token -> JSON body
  private respond(res: unknown, tokens: IssuedTokens) {
    this.cookies.setRefresh(res, tokens);
    return { accessToken: tokens.accessToken };
  }

  @Public()
  @Post('register')
  async register(
    @Body() dto: UserDto,
    @Res({ passthrough: true }) res: unknown,
  ) {
    return this.respond(res, await this.authService.register(dto));
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: unknown) {
    return this.respond(res, await this.authService.login(dto));
  }

  // Reads the refresh cookie (the browser only sends it to /auth/*)
  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Cookies(REFRESH_COOKIE) refreshToken: string | undefined,
    @Res({ passthrough: true }) res: unknown,
  ) {
    return this.respond(res, await this.authService.refresh(refreshToken));
  }

  // Log out this device
  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(
    @Cookies(REFRESH_COOKIE) refreshToken: string | undefined,
    @Res({ passthrough: true }) res: unknown,
  ) {
    this.cookies.clearRefresh(res);
    return this.authService.logout(refreshToken);
  }

  // Log out everywhere (send the access token as Bearer)
  @HttpCode(200)
  @Post('logout-all')
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: unknown,
  ) {
    this.cookies.clearRefresh(res);
    return this.authService.logoutAll(user.id);
  }
}
