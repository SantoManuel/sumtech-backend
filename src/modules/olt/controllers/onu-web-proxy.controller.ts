import {
  Controller,
  Post,
  Get,
  Param,
  Query,
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

@Controller('olt/onus')
export class OnuWebProxyController {
  constructor(private readonly proxyService: OnuWebProxyService) {}

  /**
   * Genera un token y URL segura para acceder a la GUI web de la ONU de forma remota
   */
  @Post(':id/web-proxy-session')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async createWebProxySession(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const userId = req.user?.sub || req.user?.id || 'system';
    return this.proxyService.createWebSession(id, userId);
  }

  /**
   * Endpoint de lanzamiento de la sesión: valida el token, fija la cookie de sesión
   * y reenvía directamente la página principal de la ONU al navegador o iframe.
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

    // Fijar la cookie sumtech_cpe_token en el dominio para que las peticiones
    // subsiguientes (scripts, estilos, llamadas AJAX de la ONU) viajen autorizadas.
    res.cookie('sumtech_cpe_token', token, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 2 * 60 * 60 * 1000, // 2 horas
    });

    // Reenviar directamente la solicitud raíz a la ONU
    req.url = '/';
    return this.proxyService.proxyHttpRequest(req, res, session.targetIp, session.port);
  }
}
