import { getConfiguredCorsOrigins, isAllowedCorsOrigin } from './cors-origin.util';

describe('cors-origin.util', () => {
  describe('isAllowedCorsOrigin', () => {
    const configured = ['http://localhost:3000', 'http://localhost:3001'];

    it('permite peticiones sin origen (curl, server-to-server)', () => {
      expect(isAllowedCorsOrigin(undefined, configured)).toBe(true);
    });

    it('permite un origen configurado explícitamente', () => {
      expect(isAllowedCorsOrigin('http://localhost:3000', configured)).toBe(true);
    });

    it('permite subdominios de desarrollo *.localhost:3000/3001', () => {
      expect(isAllowedCorsOrigin('http://ispazua.localhost:3000', configured)).toBe(true);
      expect(isAllowedCorsOrigin('http://admin.localhost:3001', configured)).toBe(true);
    });

    it('permite subdominios de producción *.sumtech.com', () => {
      expect(isAllowedCorsOrigin('https://ispazua.app.sumtech.com', configured)).toBe(true);
    });

    it('permite subdominios del dominio real *.sumtech.com.do', () => {
      expect(isAllowedCorsOrigin('https://erp-api.sumtech.com.do', configured)).toBe(true);
    });

    it('permite subdominios dinámicos de tenants en VPS (*.sslip.io)', () => {
      expect(isAllowedCorsOrigin('http://sumtech.66.94.107.219.sslip.io', configured)).toBe(true);
    });

    it('rechaza un origen no reconocido', () => {
      expect(isAllowedCorsOrigin('https://evil.example.com', configured)).toBe(false);
    });

    it('rechaza sumtech.com.do sin https (nunca relaja el esquema)', () => {
      expect(isAllowedCorsOrigin('http://erp-api.sumtech.com.do', configured)).toBe(false);
    });
  });

  describe('getConfiguredCorsOrigins', () => {
    const originalEnv = process.env.CORS_ORIGINS;

    afterEach(() => {
      process.env.CORS_ORIGINS = originalEnv;
    });

    it('usa el default de localhost si CORS_ORIGINS no está definida', () => {
      delete process.env.CORS_ORIGINS;
      expect(getConfiguredCorsOrigins()).toEqual(['http://localhost:3000', 'http://localhost:3001']);
    });

    it('parsea CORS_ORIGINS separada por comas y recorta espacios', () => {
      process.env.CORS_ORIGINS = 'https://a.com, https://b.com ,https://c.com';
      expect(getConfiguredCorsOrigins()).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
    });
  });
});
