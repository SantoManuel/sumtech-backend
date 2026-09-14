import { ConfigService } from '@nestjs/config';

/**
 * Falla rápido al arrancar la aplicación si alguna variable de entorno
 * obligatoria no está definida, en vez de dejar que el código siga con un
 * fallback hardcodeado (ej. un secreto JWT público en el repositorio).
 */
export function assertRequiredEnvVars(configService: ConfigService, names: string[]): void {
  const missing = names.filter((name) => {
    const value = configService.get<string>(name);
    return !value || value.trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno obligatorias: ${missing.join(', ')}. ` +
        'La aplicación no puede iniciar sin ellas (revisa el archivo .env).',
    );
  }
}

/**
 * Obtiene JWT_SECRET ya validado por assertRequiredEnvVars al boot — sin
 * fallback hardcodeado. Lanza si por alguna razón se invoca antes del boot
 * (defensa adicional, no debería ocurrir en producción).
 */
export function getJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET');
  if (!secret) {
    throw new Error('JWT_SECRET no está configurado.');
  }
  return secret;
}

export function getJwtRefreshSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_REFRESH_SECRET');
  if (!secret) {
    throw new Error('JWT_REFRESH_SECRET no está configurado.');
  }
  return secret;
}
