import { CpeProxyMiddleware } from './cpe-proxy.middleware';
import { CpeSessionStoreService } from '../services/cpe-session-store.service';

describe('CpeProxyMiddleware', () => {
  let sessionStore: CpeSessionStoreService;
  let middleware: CpeProxyMiddleware;

  beforeEach(() => {
    sessionStore = new CpeSessionStoreService();
    middleware = new CpeProxyMiddleware(sessionStore);
  });

  const mockRes = () => {
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      send(body: any) {
        this.body = body;
        return this;
      },
    };
    return res;
  };

  it('deja pasar (next) cualquier ruta que no empiece con /cpe/ -- nunca interfiere con /api, /auth, /dashboard', () => {
    const req: any = { path: '/api/v1/invoicing' };
    const res = mockRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('responde 410 si el sessionId no existe o ya expiró, sin llamar al proxy real', () => {
    const req: any = { path: '/cpe/no-existe/webcmcc/index.html' };
    const res = mockRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(res.statusCode).toBe(410);
    expect(res.body).toContain('Sesión expirada');
    expect(next).not.toHaveBeenCalled();
  });

  it('reescribe atributos de ruta absoluta (src/href/action) con el prefijo de la sesión, dejando las rutas relativas intactas', () => {
    const html = `
      <html><body>
        <link rel="stylesheet" href="/webcmcc/style.css">
        <img src="/img/logo.png">
        <img src="relative.png">
        <form action="/boaform/admin/formLogin"></form>
        <a href="https://otro-dominio.com/x">externo</a>
      </body></html>
    `;

    const result = (middleware as any).rewriteHtml(html, 'abc123');

    expect(result).toContain('href="/cpe/abc123/webcmcc/style.css"');
    expect(result).toContain('src="/cpe/abc123/img/logo.png"');
    expect(result).toContain('src="relative.png"'); // relativa: el navegador ya la resuelve sola
    expect(result).toContain('action="/cpe/abc123/boaform/admin/formLogin"');
    expect(result).toContain('href="https://otro-dominio.com/x"'); // externa: no se toca
  });

  it('no duplica el prefijo si el HTML ya lo trae (idempotente)', () => {
    const html = '<img src="/cpe/abc123/img/logo.png">';
    const result = (middleware as any).rewriteHtml(html, 'abc123');
    expect(result).toContain('src="/cpe/abc123/img/logo.png"');
    expect(result).not.toContain('/cpe/abc123/cpe/abc123');
  });

  it('reescribe un Location relativo agregando el prefijo de sesión', () => {
    const result = (middleware as any).rewriteLocation('/webcmcc/login.html', 'abc123');
    expect(result).toBe('/cpe/abc123/webcmcc/login.html');
  });

  it('reescribe un Location absoluto hacia la IP LAN fija del CPE (http://192.168.1.1/x) a solo la ruta con prefijo', () => {
    const result = (middleware as any).rewriteLocation('http://192.168.1.1/webcmcc/login.html?a=1', 'abc123');
    expect(result).toBe('/cpe/abc123/webcmcc/login.html?a=1');
  });
});
