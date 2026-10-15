import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { PortalRedirectService } from './portal-redirect.service';

/**
 * Destino único y genérico del dst-nat que cada MikroTik aplica a sus
 * clientes suspendidos en modo Portal de Aviso (NOTICE_PORTAL) -- ver
 * NodePortalRegistryEntity para el diseño completo. Vive bajo /platform/*
 * a propósito: esa ruta ya está excluida de TenantResolutionMiddleware
 * (ver AppModule), porque esta petición nunca trae un tenant resuelto (el
 * Host es el del sitio externo que el cliente quería visitar, no el
 * nuestro) -- identificar el tenant es exactamente el trabajo de este
 * controlador, por IP de origen, no por Host.
 *
 * Sin autenticación ni guard: cualquier router de cualquier tenant debe
 * poder pegarle, y el único dato sensible que expone es "a qué tenant
 * redirigir", no datos de cliente (eso lo resuelve /aviso ya del lado del
 * tenant correcto, vía /public/suspension-portal/identify).
 */
@Controller('platform/portal-redirect')
export class PortalRedirectController {
  constructor(private readonly portalRedirectService: PortalRedirectService) {}

  @Get()
  async redirect(@Req() req: Request, @Res() res: Response): Promise<void> {
    const sourceIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (req.headers['x-real-ip'] as string) ||
      req.socket.remoteAddress ||
      req.ip;

    const redirectUrl = await this.portalRedirectService.resolveRedirectUrl(sourceIp);

    if (redirectUrl) {
      res.redirect(302, redirectUrl);
      return;
    }

    res
      .status(200)
      .type('text/html')
      .send(
        '<!doctype html><html><head><meta charset="utf-8"><title>Servicio suspendido</title></head>' +
          '<body style="font-family:sans-serif;text-align:center;padding:40px;">' +
          '<h2>Tu servicio de Internet está suspendido</h2>' +
          '<p>No pudimos identificar automáticamente a tu proveedor. Comunícate con soporte técnico de tu ISP.</p>' +
          '</body></html>',
      );
  }
}
