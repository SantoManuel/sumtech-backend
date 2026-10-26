import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { assertRequiredEnvVars } from './common/utils/required-env.util';
import { getConfiguredCorsOrigins, isAllowedCorsOrigin } from './common/utils/cors-origin.util';

async function bootstrap() {
  const logger = new Logger('SumtechBootstrap');
  const app = await NestFactory.create(AppModule);

  // Falla rápido si faltan secretos críticos, en vez de arrancar con
  // fallbacks hardcodeados inseguros (ver required-env.util.ts)
  assertRequiredEnvVars(app.get(ConfigService), ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'PLATFORM_JWT_SECRET']);

  const configuredOrigins = getConfiguredCorsOrigins();

  app.use(cookieParser());

  // Habilitar CORS multi-tenant (soporta *.localhost:3000, *.localhost:3001, IPs locales y dominios SaaS)
  // Política de orígenes en cors-origin.util.ts -- reutilizada también por
  // RouterConsoleGateway (WebSocket) para no desincronizar la lista.
  app.enableCors({
    origin: (requestOrigin, callback) => {
      if (isAllowedCorsOrigin(requestOrigin, configuredOrigins)) {
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
  //
  // Excepción: los 3 endpoints de recepción B2B de e-CF (DgiiRecepcionB2bController,
  // DgiiAutenticacionB2bController, DgiiAprobacionComercialB2bController en
  // dgii-b2b.controller.ts) deben vivir en las rutas EXACTAS que exige el
  // formulario de certificación de la DGII ("Paso 7: URL Servicio de Prueba"):
  // https://<host>/fe/autenticacion/api/[semilla|ValidacionCertificado]
  // https://<host>/fe/recepcion/api/ecf
  // https://<host>/fe/aprobacioncomercial/api/ecf
  // La DGII concatena esos sufijos fijos a la URL que se le declara — si el
  // prefijo global los antepusiera (quedarían en /api/v1/fe/...), la
  // validación de la DGII fallaría con 404 contra la URL real.
  const apiPrefix = process.env.API_PREFIX || 'api/v1';
  app.setGlobalPrefix(apiPrefix, {
    exclude: [
      { path: 'fe/autenticacion/api/semilla', method: RequestMethod.GET },
      { path: 'fe/autenticacion/api/validacioncertificado', method: RequestMethod.POST },
      { path: 'fe/autenticacion/api/ValidacionCertificado', method: RequestMethod.POST },
      { path: 'fe/recepcion/api/ecf', method: RequestMethod.POST },
      { path: 'fe/aprobacioncomercial/api/ecf', method: RequestMethod.POST },
    ],
  });

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
