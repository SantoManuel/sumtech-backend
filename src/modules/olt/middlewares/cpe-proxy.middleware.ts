import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware, responseInterceptor, Options } from 'http-proxy-middleware';
import * as cheerio from 'cheerio';
import { CpeSessionStoreService } from '../services/cpe-session-store.service';

const SESSION_PREFIX = '/cpe/';

/**
 * Proxy inverso a la interfaz web embebida de una ONU (Ficha 360 → "Interfaz
 * Web de la ONU"), con aislamiento REAL por sesión -- ver
 * CpeSessionStoreService para por qué se abandonó la cookie global
 * `sumtech_cpe_token` que existía antes acá.
 *
 * Montado en OltModule.configure() solo para rutas bajo `/cpe/` (ver
 * olt.module.ts) -- a diferencia de la versión anterior, que corría como
 * middleware de Express global (`app.use()` en main.ts, ANTES de CORS)
 * sobre cada petición al backend con una lista manual de exclusiones
 * (`/api/`, `/auth/`, etc.) para no interferir. Montarlo en una ruta
 * específica es un aislamiento real a nivel de Express, no una lista de
 * prefijos que hay que recordar mantener.
 *
 * El `sessionId` viaja en la URL (`/cpe/<sessionId>/webcmcc/index.html`), NO
 * en una cookie -- así cada pestaña/ONU queda autocontenida. Las páginas que
 * devuelve el CPE casi siempre son HTML simple con referencias RELATIVAS
 * (sin "/" inicial), que el navegador ya resuelve solas contra la URL actual
 * (que incluye el prefijo `/cpe/<sessionId>/...`) sin que haga falta tocar
 * nada. Solo las referencias de RUTA ABSOLUTA (`src="/algo"`,
 * `action="/algo"`) escaparían ese prefijo si no se reescriben -- de ahí el
 * paso de Cheerio en `rewriteHtml()`.
 */
@Injectable()
export class CpeProxyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(CpeProxyMiddleware.name);
  private readonly proxy: ReturnType<typeof createProxyMiddleware>;

  constructor(private readonly sessionStore: CpeSessionStoreService) {
    this.proxy = createProxyMiddleware(this.buildOptions());
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (!req.path.startsWith(SESSION_PREFIX)) {
      return next();
    }

    const [, , sessionId] = req.path.split('/');
    const session = sessionId ? this.sessionStore.get(sessionId) : null;
    if (!session) {
      res.status(410).send(`
        <html>
          <body style="background:#0f172a;color:#f87171;font-family:sans-serif;padding:24px;text-align:center;">
            <h2>Sesión expirada o inválida</h2>
            <p>Cierra esta ventana y vuelve a abrir la Interfaz Web de la ONU desde su Ficha 360.</p>
          </body>
        </html>
      `);
      return;
    }

    (req as any).cpeSession = session;
    (req as any).cpeSessionId = sessionId;
    this.proxy(req, res, next);
  }

  private buildOptions(): Options {
    return {
      // Overridden en cada petición por `router` -- valor requerido por la
      // librería pero nunca usado de verdad.
      target: 'http://127.0.0.1',
      changeOrigin: false,
      selfHandleResponse: true,
      logLevel: 'silent',
      router: (req: Request) => {
        const session = (req as any).cpeSession;
        return `http://${session.targetIp}:${session.port}`;
      },
      pathRewrite: (_path: string, req: Request) => {
        const sessionId = (req as any).cpeSessionId;
        // req.originalUrl trae el prefijo completo acá (el middleware se
        // registra para TODO bajo /, no sub-montado con app.use(prefix,...)),
        // así que hay que quitarlo a mano en vez de depender del recorte
        // automático de Express para un mount point.
        const prefix = `${SESSION_PREFIX}${sessionId}`;
        const rest = req.originalUrl.startsWith(prefix) ? req.originalUrl.slice(prefix.length) : req.originalUrl;
        return rest || '/';
      },
      onProxyReq: (proxyReq, req: any) => {
        const session = (req as any).cpeSession;
        const isHuawei = Boolean(
          session?.serialNumber?.toUpperCase().startsWith('HWTC') ||
          session?.serialNumber?.toUpperCase().startsWith('CMDC'),
        );

        // Si la ONU es Huawei o su IP de destino está en la subred 192.168.100.0/24,
        // su IP LAN de fábrica es 192.168.100.1; para ZTE, VSOL y otros fabricantes es 192.168.1.1.
        let lanHost = '192.168.1.1';
        if (session?.targetIp === '192.168.100.1' || session?.targetIp?.startsWith('192.168.100.') || isHuawei) {
          lanHost = '192.168.100.1';
        }

        // Los firmwares embebidos de CPE (Huawei Boa, ZTE, etc.) exigen que
        // el encabezado Host sea su IP de LAN fija (o la IP con la que fueron consultados),
        // o fuerzan una redirección de seguridad a su portal cautivo.
        proxyReq.setHeader('host', lanHost);

        // Filtrar cookies de la plataforma Sumtech para que no viajen a la ONU,
        // pero permitir que las cookies de sesión del CPE (ej. SessionID de Huawei)
        // se envíen en peticiones subsecuentes tras autenticarse en su GUI.
        const cookieHeader = req.headers?.['cookie'];
        if (typeof cookieHeader === 'string') {
          const cpeCookies = cookieHeader
            .replace(/sumtech_[^=]+=[^;]+;?\s*/g, '')
            .trim();
          if (cpeCookies) {
            proxyReq.setHeader('cookie', cpeCookies);
          } else {
            proxyReq.removeHeader('cookie');
          }
        } else {
          proxyReq.removeHeader('cookie');
        }
      },
      onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        const sessionId = (req as any).cpeSessionId as string;
        const targetIp = (req as any).cpeSession?.targetIp;
        const headers = proxyRes.headers;

        delete headers['x-frame-options'];
        delete headers['content-security-policy'];
        (res as any).removeHeader?.('x-frame-options');
        (res as any).removeHeader?.('content-security-policy');
        const requestOrigin = (req.headers.origin as string) || undefined;
        if (requestOrigin) {
          (res as any).setHeader('access-control-allow-origin', requestOrigin);
          (res as any).setHeader('access-control-allow-credentials', 'true');
        }

        if (headers.location) {
          (res as any).setHeader('location', this.rewriteLocation(String(headers.location), sessionId));
        }

        const setCookie = headers['set-cookie'];
        if (setCookie) {
          // El propio CPE puede fijar su propia cookie de sesión (ajena a
          // nuestro sessionId) -- se le fuerza el Path al prefijo de ESTA
          // sesión para que nunca pueda filtrarse a la de otra ONU abierta
          // en paralelo en otra pestaña (mismo origen compartido).
          const scoped = (Array.isArray(setCookie) ? setCookie : [setCookie]).map((c) =>
            /;\s*Path=/i.test(c) ? c.replace(/;\s*Path=[^;]*/i, `; Path=/cpe/${sessionId}`) : `${c}; Path=/cpe/${sessionId}`,
          );
          (res as any).setHeader('set-cookie', scoped);
        }

        const contentType = String(headers['content-type'] || '');
        if (!contentType.includes('text/html')) {
          return responseBuffer;
        }
        try {
          return this.rewriteHtml(responseBuffer.toString('utf8'), sessionId, targetIp);
        } catch (err: any) {
          this.logger.warn(`No se pudo reescribir el HTML del CPE (sesión ${sessionId}): ${err.message}`);
          return responseBuffer;
        }
      }),
      onError: (err, req, res) => {
        this.logger.error(`Error reenviando petición al CPE: ${err.message}`);
        const response = res as Response;
        if (!response.headersSent) {
          response.status(502).send(`
            <html>
              <body style="background:#0f172a;color:#f87171;font-family:sans-serif;padding:24px;text-align:center;">
                <h2>No se pudo conectar a la interfaz web de la ONU</h2>
                <p>Detalle: ${err.message}</p>
              </body>
            </html>
          `);
        }
      },
    };
  }

  /** Reescribe src/href/action/form y URLs absolutas a 192.168.1.1, 192.168.100.1 o targetIp para que sigan dentro del prefijo de esta sesión. */
  private rewriteHtml(html: string, sessionId: string, targetIp?: string): string {
    const prefix = `/cpe/${sessionId}`;

    // Reemplazar URLs absolutas incrustadas en scripts o atributos que apunten a 192.168.1.1 o 192.168.100.1
    let processedHtml = html
      .replace(/https?:\/\/192\.168\.100\.1(?::\d+)?\//gi, `${prefix}/`)
      .replace(/https?:\/\/192\.168\.1\.1(?::\d+)?\//gi, `${prefix}/`);

    if (targetIp && targetIp !== '192.168.1.1' && targetIp !== '192.168.100.1') {
      const escapedIp = targetIp.replace(/\./g, '\\.');
      processedHtml = processedHtml.replace(new RegExp(`https?:\\/\\/${escapedIp}(?::\\d+)?\\/`, 'gi'), `${prefix}/`);
    }

    const $ = cheerio.load(processedHtml);
    const attrsByTag: Array<[string, string]> = [
      ['[src]', 'src'],
      ['link[href]', 'href'],
      ['a[href]', 'href'],
      ['form[action]', 'action'],
    ];
    for (const [selector, attr] of attrsByTag) {
      $(selector).each((_i, el) => {
        const value = $(el).attr(attr);
        if (value && value.startsWith('/') && !value.startsWith(prefix)) {
          $(el).attr(attr, `${prefix}${value}`);
        }
      });
    }
    return $.html();
  }

  /** Igual que rewriteHtml pero para el header Location de una redirección HTTP. */
  private rewriteLocation(location: string, sessionId: string): string {
    const prefix = `/cpe/${sessionId}`;
    try {
      const parsed = new URL(location);
      // Absoluta hacia la propia IP del CPE (ej. "http://192.168.1.1/x") -- se
      // reduce a la ruta y se reinserta el prefijo de sesión.
      return parsed.pathname.startsWith(prefix) ? parsed.pathname + parsed.search : `${prefix}${parsed.pathname}${parsed.search}`;
    } catch {
      // Ya era relativa, ej: "/webcmcc/login.html"
      return location.startsWith(prefix) ? location : `${prefix}${location.startsWith('/') ? '' : '/'}${location}`;
    }
  }
}
