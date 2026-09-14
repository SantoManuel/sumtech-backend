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
  assertRequiredEnvVars(app.get(ConfigService), ['JWT_SECRET', 'JWT_REFRESH_SECRET']);

  const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [
    'http://localhost:3000',
  ];

  app.use(cookieParser());

  // Habilitar CORS
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
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
