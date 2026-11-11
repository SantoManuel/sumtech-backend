import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { OnuWebProxyService } from '../services/onu-web-proxy.service';
import { CpeSessionStoreService } from '../services/cpe-session-store.service';
import { CreateWebProxySessionDto } from '../dto/create-web-proxy-session.dto';

@Controller('olt/onus')
export class OnuWebProxyController {
  constructor(
    private readonly proxyService: OnuWebProxyService,
    private readonly sessionStore: CpeSessionStoreService,
  ) {}

  /**
   * Genera un token y URL segura para acceder a la GUI web de la ONU de forma remota.
   * Si la ONU no tiene contacto con GenieACS ni WAN estática, `manualIp` permite
   * al operador indicar la IP de gestión conocida -- se persiste para no volver
   * a pedirla en sesiones futuras.
   */
  @Post(':id/web-proxy-session')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async createWebProxySession(
    @Param('id') id: string,
    @Body() dto: CreateWebProxySessionDto,
    @Req() req: any,
  ) {
    const userId = req.user?.sub || req.user?.id || 'system';
    return this.proxyService.createWebSession(id, userId, dto.manualIp);
  }

  /**
   * Endpoint de lanzamiento de la sesión: valida el token de un solo uso y
   * crea una sesión de proxy aislada por ruta (`/cpe/<sessionId>/...`) -- ver
   * CpeSessionStoreService para por qué ya NO se usa una cookie compartida
   * (abrir una segunda ONU en otra pestaña pisaba silenciosamente la sesión
   * de la primera, confirmado en vivo 2026-11-10).
   */
  @Get('web-proxy/launch')
  async launchWebSession(
    @Query('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!token) {
      throw new BadRequestException('Token de sesión no especificado.');
    }

    const session = this.proxyService.verifySessionToken(token);
    if (!session) {
      throw new UnauthorizedException('El token de sesión ha expirado o es inválido.');
    }

    const sessionId = this.sessionStore.create({
      onuId: session.onuId,
      serialNumber: session.serialNumber,
      targetIp: session.targetIp,
      port: session.port,
      userId: session.userId,
    });

    const targetPath = session.defaultPath || '/';
    return res.redirect(302, `/cpe/${sessionId}${targetPath}`);
  }
}
