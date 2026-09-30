import { Controller, Post, Get, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { CurrentPlatformUser } from './decorators/current-platform-user.decorator';
import { PlatformJwtPayload } from './interfaces/platform-jwt-payload.interface';

@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly platformAuthService: PlatformAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: PlatformLoginDto) {
    return this.platformAuthService.login(dto);
  }

  // Endpoint mínimo para verificar el guard/token — también útil para el
  // panel SuperAdmin de la Fase 6 (whoami).
  @Get('me')
  @UseGuards(PlatformAuthGuard)
  async me(@CurrentPlatformUser() platformUser: PlatformJwtPayload) {
    return { id: platformUser.sub, email: platformUser.email, role: platformUser.role };
  }
}
