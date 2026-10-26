import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { OnuWebProxyService } from '../services/onu-web-proxy.service';

@Injectable()
export class CpeProxyMiddleware implements NestMiddleware {
  constructor(private readonly proxyService: OnuWebProxyService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Si la petición es para una ruta de la API normal o de facturación DGII B2B, no interceptar
    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/fe/') ||
      req.path.startsWith('/socket.io')
    ) {
      return next();
    }

    // Verificar si el navegador trae la cookie de sesión CPE activa o token en query
    const token =
      req.cookies?.['sumtech_cpe_token'] ||
      (req.query?.['sumtech_cpe_token'] as string) ||
      (req.query?.['cpe_token'] as string) ||
      (req.query?.['token'] as string);

    if (!token) {
      return next();
    }

    const session = this.proxyService.verifySessionToken(token);
    if (!session) {
      return next();
    }

    // Asegurar que la cookie esté fijada en el navegador si el token vino en el query string
    if (!req.cookies?.['sumtech_cpe_token']) {
      res.cookie('sumtech_cpe_token', token, {
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'none',
        maxAge: 2 * 60 * 60 * 1000,
      });
    }

    // Interceptar y reenviar la petición (CSS, JS, imágenes, AJAX, páginas HTML de la ONU)
    return this.proxyService.proxyHttpRequest(
      req,
      res,
      session.targetIp,
      session.port,
      token,
    );
  }
}
