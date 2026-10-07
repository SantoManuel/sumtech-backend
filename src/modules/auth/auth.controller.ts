import { Controller, Post, Body, HttpCode, HttpStatus, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifySupervisorDto } from './dto/verify-supervisor.dto';
import { Public } from '../../common/decorators/public.decorator';
import { REFRESH_TOKEN_COOKIE_NAME, buildRefreshCookieOptions, parseDurationToMs } from './utils/refresh-cookie.util';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshCookie(res: Response, refreshTokenRaw: string, expirationConfig?: string) {
    res.cookie(
      REFRESH_TOKEN_COOKIE_NAME,
      refreshTokenRaw,
      buildRefreshCookieOptions(parseDurationToMs(expirationConfig)),
    );
  }

  private extractMetadata(req: Request) {
    return {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { refreshTokenRaw, ...result } = await this.authService.login(loginDto, this.extractMetadata(req));
    this.setRefreshCookie(res, refreshTokenRaw);
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
    if (!rawRefreshToken) {
      throw new UnauthorizedException('No hay sesión activa para renovar.');
    }

    const { refreshTokenRaw, ...result } = await this.authService.refreshToken(
      rawRefreshToken,
      this.extractMetadata(req),
    );
    this.setRefreshCookie(res, refreshTokenRaw);
    return result;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
    await this.authService.logout(rawRefreshToken);
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, buildRefreshCookieOptions());
    return { success: true, message: 'Sesión cerrada con éxito' };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const origin = (req.headers['origin'] || req.headers['referer']) as string | undefined;
    return this.authService.requestPasswordReset(dto, origin);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('verify-supervisor')
  @HttpCode(HttpStatus.OK)
  async verifySupervisor(@Body() dto: VerifySupervisorDto) {
    const supervisor = await this.authService.verifySupervisorCredentials(dto.identifier, dto.password);
    return {
      valid: true,
      supervisor,
    };
  }
}
