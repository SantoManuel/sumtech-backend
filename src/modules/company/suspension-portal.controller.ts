import {
  Controller,
  Get,
  Patch,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { SuspensionPortalService } from './suspension-portal.service';

@Controller()
export class SuspensionPortalController {
  constructor(private readonly portalService: SuspensionPortalService) {}

  /**
   * Endpoint público consumido por la página de aviso /aviso.
   * Resuelve el cliente automáticamente por la IP de origen o por búsqueda manual (cédula/contrato).
   * RF-PORTAL-002.
   */
  @Get('public/suspension-portal/identify')
  @Public()
  async identifyClient(@Req() req: Request, @Query('search') search?: string) {
    const rawIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      (req.headers['x-real-ip'] as string) ||
      req.socket.remoteAddress ||
      req.ip;

    return this.portalService.identifyClient({
      ip: rawIp,
      search,
    });
  }

  /**
   * Obtiene la configuración actual del portal de suspensión para el dashboard de administración.
   */
  @Get('company/suspension-portal')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.GERENTE)
  async getPortalConfig() {
    return this.portalService.getPortalConfig();
  }

  /**
   * Actualiza la configuración, colores y métodos de pago del portal de suspensión (RF-PORTAL-003).
   */
  @Patch('company/suspension-portal')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.GERENTE)
  async updatePortalConfig(
    @Body()
    body: {
      whatsapp?: string;
      suspensionPortal?: Record<string, any>;
      telegramBotToken?: string;
      telegramChatId?: string;
      telegramAlertsEnabled?: boolean;
    },
  ) {
    return this.portalService.updatePortalConfig(body);
  }
}
