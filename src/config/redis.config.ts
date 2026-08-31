/**
 * ARCHIVO: src/config/redis.config.ts
 * CAPA: Configuración de Infraestructura de Caché / Sesión
 * 
 * RESPONSABILIDAD:
 * - Configura la conexión de cliente Redis (ioredis) para el sistema ERP.
 * - Carga variables de entorno: REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DB.
 * - Define prefijos de claves para el aislamiento de dominios (ej. 'pos:cart:', 'auth:blacklist:', 'cache:plans:').
 * - Provee soporte para TTL automático de carritos de compra efímeros y revocación instantánea de sesiones de usuario.
 * 
 * EXPORTA:
 * - redisConfig: registerAs('redis', () => RedisOptions)
 */
export {};
