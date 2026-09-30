import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';

import { databaseConfig } from './config/database.config';
import { platformDatabaseConfig } from './config/platform-database.config';
import { TenancyModule } from './common/tenancy/tenancy.module';
import { TenantResolutionMiddleware } from './common/tenancy/tenant-resolution.middleware';
import { TenancySmokeTestModule } from './common/tenancy/tenancy-smoke-test.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { PlansModule } from './modules/plans/plans.module';
import { ClientsModule } from './modules/clients/clients.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { PosModule } from './modules/pos/pos.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { CrmModule } from './modules/crm/crm.module';
import { PublicModule } from './modules/public/public.module';
import { CoordinationModule } from './modules/coordination/coordination.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PortalModule } from './modules/portal/portal.module';
import { GeographyModule } from './modules/geography/geography.module';
import { BillingModule } from './modules/billing/billing.module';
import { DailyClosuresModule } from './modules/daily-closures/daily-closures.module';
import { NetworkModule } from './modules/network/network.module';
import { OltModule } from './modules/olt/olt.module';
import { GenieAcsModule } from './modules/genieacs/genieacs.module';
import { CompanyModule } from './modules/company/company.module';
import { BranchesModule } from './modules/branches/branches.module';
import { PlatformModule } from './modules/platform/platform.module';

@Module({
  imports: [
    // Configuración Global
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, platformDatabaseConfig],
    }),

    // Persistencia TypeORM con PostgreSQL 3NF Multi-Esquema
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbConf = configService.get('database');
        return dbConf;
      },
    }),

    // Conexión SEPARADA a la DB de plataforma (sumtech_platform) — registro de
    // tenants SaaS, planes, suscripciones y usuarios SuperAdmin. Estática (no
    // dinámica como la de un tenant): solo existe una DB de plataforma.
    TypeOrmModule.forRootAsync({
      name: 'platform',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const platformDbConf = configService.get('platformDatabase');
        return platformDbConf;
      },
    }),

    // Bus de Eventos Asíncronos
    EventEmitterModule.forRoot(),

    // Tareas Programadas (Cron) — motor de facturación recurrente y morosidad
    ScheduleModule.forRoot(),

    // Rate limiting — se aplica explícitamente solo en /public/chat/* (ver
    // PublicController), no como guard global: el resto de la API no tenía
    // ninguna protección de este tipo y no es objetivo de este cambio tocarla.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),

    // Cola de jobs en background (Redis, vía DBngin en desarrollo) — usada
    // por la importación masiva de clientes (ClientsImportModule) para no
    // bloquear un request HTTP con archivos de decenas de miles de filas.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
          db: configService.get<number>('REDIS_DB', 0),
        },
      }),
    }),

    // Módulos de Dominio del Monolito Modular
    AuthModule,
    UsersModule,
    EmployeesModule,
    BranchesModule,
    PlansModule,
    ClientsModule,
    InventoryModule,
    InvoicingModule,
    PosModule,
    TicketsModule,
    CrmModule,
    PublicModule,
    CoordinationModule,
    DashboardModule,
    PortalModule,
    GeographyModule,
    BillingModule,
    DailyClosuresModule,
    NetworkModule,
    OltModule,
    GenieAcsModule,
    CompanyModule,
    PlatformModule,
    TenancyModule,
    TenancySmokeTestModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Resuelve el tenant por subdominio (header Host) para TODAS las rutas
    // excepto /platform/* — SuperAdmin y el futuro auto-registro de tenants
    // (Fase 3/7), que por definición corren SIN un tenant resuelto todavía.
    // OJO: /public/* (plans/leads/chat) NO se excluye a propósito — según el
    // diseño de la Fase 4, ese contenido es propio de cada ISP (planes
    // públicos, captación de leads) y debe resolverse por subdominio igual
    // que cualquier otra ruta de negocio, no es contenido de la plataforma.
    consumer
      .apply(TenantResolutionMiddleware)
      .exclude(
        { path: 'platform/(.*)', method: RequestMethod.ALL },
        { path: 'platform', method: RequestMethod.ALL },
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
