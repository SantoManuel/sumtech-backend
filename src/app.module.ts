import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { databaseConfig } from './config/database.config';
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

@Module({
  imports: [
    // Configuración Global
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
    }),

    // Persistencia TypeORM con PostgreSQL 3NF Multi-Esquema
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbConf = configService.get('database');
        return dbConf;
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

    // Módulos de Dominio del Monolito Modular
    AuthModule,
    UsersModule,
    EmployeesModule,
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
  ],
})
export class AppModule {}
