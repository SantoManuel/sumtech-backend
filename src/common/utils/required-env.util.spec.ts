import { ConfigService } from '@nestjs/config';
import { assertRequiredEnvVars, getJwtSecret, getJwtRefreshSecret } from './required-env.util';

function buildConfigService(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('required-env.util', () => {
  describe('assertRequiredEnvVars', () => {
    it('no lanza cuando todas las variables requeridas están presentes', () => {
      const configService = buildConfigService({ JWT_SECRET: 'abc', JWT_REFRESH_SECRET: 'def' });

      expect(() => assertRequiredEnvVars(configService, ['JWT_SECRET', 'JWT_REFRESH_SECRET'])).not.toThrow();
    });

    it('lanza si falta una variable requerida', () => {
      const configService = buildConfigService({ JWT_SECRET: 'abc', JWT_REFRESH_SECRET: undefined });

      expect(() => assertRequiredEnvVars(configService, ['JWT_SECRET', 'JWT_REFRESH_SECRET'])).toThrow(
        /JWT_REFRESH_SECRET/,
      );
    });

    it('lanza si una variable requerida está vacía o solo tiene espacios', () => {
      const configService = buildConfigService({ JWT_SECRET: '   ' });

      expect(() => assertRequiredEnvVars(configService, ['JWT_SECRET'])).toThrow(/JWT_SECRET/);
    });

    it('reporta todas las variables faltantes en el mismo error', () => {
      const configService = buildConfigService({});

      expect(() => assertRequiredEnvVars(configService, ['JWT_SECRET', 'JWT_REFRESH_SECRET'])).toThrow(
        /JWT_SECRET.*JWT_REFRESH_SECRET/s,
      );
    });
  });

  describe('getJwtSecret / getJwtRefreshSecret', () => {
    it('retorna el valor configurado sin fallback hardcodeado', () => {
      const configService = buildConfigService({ JWT_SECRET: 'mi-secreto', JWT_REFRESH_SECRET: 'mi-refresh-secreto' });

      expect(getJwtSecret(configService)).toBe('mi-secreto');
      expect(getJwtRefreshSecret(configService)).toBe('mi-refresh-secreto');
    });

    it('lanza en vez de devolver un secreto por defecto si falta la configuración', () => {
      const configService = buildConfigService({});

      expect(() => getJwtSecret(configService)).toThrow(/JWT_SECRET/);
      expect(() => getJwtRefreshSecret(configService)).toThrow(/JWT_REFRESH_SECRET/);
    });
  });
});
