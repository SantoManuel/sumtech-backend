import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';

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
  ],
})
export class AppModule {}
