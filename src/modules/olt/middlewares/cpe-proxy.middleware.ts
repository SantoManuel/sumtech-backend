import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { OnuWebProxyService } from '../services/onu-web-proxy.service';

@Injectable()
export class CpeProxyMiddleware implements NestMiddleware {
  constructor(private readonly proxyService: OnuWebProxyService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // NUNCA interceptar rutas del ERP (API, auth, facturación, sockets, plataforma, etc.)
    const pathname = req.path || req.url || '';
    if (
      pathname.startsWith('/api/') ||
      pathname.startsWith('/auth/') ||
      pathname.startsWith('/fe/') ||
      pathname.startsWith('/platform/') ||
      pathname.startsWith('/socket.io') ||
      pathname.startsWith('/public/') ||
      pathname.startsWith('/users/') ||
      pathname.startsWith('/clients/') ||
      pathname.startsWith('/dashboard/') ||
      pathname.startsWith('/login')
    ) {
      return next();
    }

    // Solo interceptar si es una ruta explícita del firmware de la ONU,
    // o si la petición trae explícitamente el token CPE en la URL,
    // o si el referer proviene de la interfaz de la ONU (/webcmcc/)
    const referer = req.headers.referer || '';
    const isExplicitCpeRoute =
      pathname.startsWith('/webcmcc/') ||
      pathname.startsWith('/boaform/') ||
      pathname.startsWith('/aoaform/') ||
      referer.includes('/webcmcc/') ||
      referer.includes('/boaform/') ||
      (req.url && req.url.includes('token='));

    if (!isExplicitCpeRoute) {
      return next();
    }

    // Verificar si el navegador trae la cookie de sesión CPE activa o token en query
    let token =
      req.cookies?.['sumtech_cpe_token'] ||
      (req.query?.['sumtech_cpe_token'] as string) ||
      (req.query?.['cpe_token'] as string) ||
      (req.query?.['token'] as string);

    if (!token && req.url && req.url.includes('token=')) {
      try {
        const u = new URL(req.url, 'http://localhost');
        token =
          u.searchParams.get('sumtech_cpe_token') ||
          u.searchParams.get('cpe_token') ||
          u.searchParams.get('token') ||
          undefined;
      } catch {
        // ignore
      }
    }

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
