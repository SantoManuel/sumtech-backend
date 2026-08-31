/**
 * ARCHIVO: src/config/jwt.config.ts
 * CAPA: Configuración de Seguridad
 * 
 * RESPONSABILIDAD:
 * - Define las opciones para la generación y verificación de tokens criptográficos JSON Web Token (JWT).
 * - Carga variables de entorno: JWT_SECRET, JWT_EXPIRATION_TIME (por defecto '15m'), JWT_REFRESH_SECRET, JWT_REFRESH_EXPIRATION_TIME (por defecto '7d').
 * 
 * EXPORTA:
 * - jwtConfig: registerAs('jwt', () => JwtModuleOptions)
 */
export {};
