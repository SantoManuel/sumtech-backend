import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { assertRequiredEnvVars } from './common/utils/required-env.util';

async function bootstrap() {
  const logger = new Logger('SumtechBootstrap');
  const app = await NestFactory.create(AppModule);

  // Falla rápido si faltan secretos críticos, en vez de arrancar con
  // fallbacks hardcodeados inseguros (ver required-env.util.ts)
  assertRequiredEnvVars(app.get(ConfigService), ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'PLATFORM_JWT_SECRET']);

  const configuredOrigins = (process.env.CORS_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:3001',
  ]).map((o) => o.trim());

  app.use(cookieParser());

  // Habilitar CORS multi-tenant (soporta *.localhost:3000, *.localhost:3001, IPs locales y dominios SaaS)
  app.enableCors({
    origin: (requestOrigin, callback) => {
      // Permitir peticiones sin origen (curl, server-to-server, Postman)
      if (!requestOrigin) {
        return callback(null, true);
      }

      // 1. Orígenes configurados explícitamente en variables de entorno
      if (configuredOrigins.includes(requestOrigin)) {
        return callback(null, true);
      }

      // 2. Subdominios dinámicos de desarrollo: *.localhost:3000 y *.localhost:3001
      // Ej: http://sumtech.localhost:3000, http://admin.localhost:3000, http://ispazua.localhost:3001
      const isLocalhostSubdomain = /^https?:\/\/([a-z0-9-]+\.)*localhost:(3000|3001)$/i.test(requestOrigin);
      if (isLocalhostSubdomain) {
        return callback(null, true);
      }

      // 3. Subdominios de producción: *.app.sumtech.com, *.sumtech.com
      const isSumtechDomain = /^https:\/\/([a-z0-9-]+\.)*sumtech\.com$/i.test(requestOrigin);
      if (isSumtechDomain) {
        return callback(null, true);
      }

      // 4. Subdominios dinámicos de tenants en VPS (*.sslip.io)
      // Ej: http://sumtech.66.94.107.219.sslip.io, http://admin.66.94.107.219.sslip.io
      const isSslipDomain = /^https?:\/\/([a-z0-9-]+\.)+[0-9.]+\.sslip\.io(:\d+)?$/i.test(requestOrigin);
      if (isSslipDomain) {
        return callback(null, true);
      }

      logger.warn(`Petición bloqueada por política CORS desde origen no autorizado: ${requestOrigin}`);
      return callback(new Error(`Origen CORS no permitido: ${requestOrigin}`), false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Tenant-Slug',
      'X-Is-Superadmin',
    ],
  });

  // Prefijo Global de API
  const apiPrefix = process.env.API_PREFIX || 'api/v1';
  app.setGlobalPrefix(apiPrefix);

  // Pipe Global de Validación de DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const port = parseInt(process.env.PORT || '4000', 10);
  await app.listen(port);

  logger.log(` ==========================================================`);
  logger.log(` SERVIDOR SUMTECH BACKEND LISTO Y OPERATIVO EN EL PUERTO ${port}`);
  logger.log(` URL BASE API: http://localhost:${port}/${apiPrefix}`);
  logger.log(` ESQUEMAS BD: sec, com, pos, inv, tickets, crm`);
  logger.log(` ==========================================================`);
}

bootstrap().catch((err) => {
  console.error('Error iniciando el servidor NestJS:', err);
  process.exit(1);
});
