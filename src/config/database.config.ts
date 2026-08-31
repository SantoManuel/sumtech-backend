import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';

// Entidades del Dominio
import { UserEntity } from '../modules/users/entities/user.entity';
import { RoleEntity } from '../modules/users/entities/role.entity';
import { AuditLogEntity } from '../modules/users/entities/audit-log.entity';
import { EmployeeEntity } from '../modules/employees/entities/employee.entity';
import { PlanEntity } from '../modules/plans/entities/plan.entity';
import { ClientEntity } from '../modules/clients/entities/client.entity';
import { AddressEntity } from '../modules/clients/entities/address.entity';
import { ContractEntity } from '../modules/clients/entities/contract.entity';
import { ProductEntity } from '../modules/inventory/entities/product.entity';
import { SerialNumberEntity } from '../modules/inventory/entities/serial-number.entity';
import { StockMovementEntity } from '../modules/inventory/entities/stock-movement.entity';
import { WarehouseEntity } from '../modules/inventory/entities/warehouse.entity';
import { EquipmentMovementEntity } from '../modules/inventory/entities/equipment-movement.entity';
import { StockItemEntity } from '../modules/inventory/entities/stock-item.entity';
import { CashRegisterEntity } from '../modules/pos/entities/cash-register.entity';
import { SaleEntity } from '../modules/pos/entities/sale.entity';
import { SaleDetailEntity } from '../modules/pos/entities/sale-detail.entity';
import { InvoiceEntity } from '../modules/invoicing/entities/invoice.entity';
import { EcfSequenceEntity } from '../modules/invoicing/entities/ecf-sequence.entity';
import { SlaPolicyEntity } from '../modules/tickets/entities/sla-policy.entity';
import { TicketEntity } from '../modules/tickets/entities/ticket.entity';
import { TicketHistoryEntity } from '../modules/tickets/entities/ticket-history.entity';
import { TicketRepairEntity } from '../modules/tickets/entities/ticket-repair.entity';
import { ScheduleEventEntity } from '../modules/tickets/entities/schedule-event.entity';
import { LeadEntity } from '../modules/crm/entities/lead.entity';
import { InteractionEntity } from '../modules/crm/entities/interaction.entity';
import { DepositProofEntity } from '../modules/portal/entities/deposit-proof.entity';
import { PlanChangeRequestEntity } from '../modules/portal/entities/plan-change-request.entity';
import { ClientNotificationEntity } from '../modules/portal/entities/client-notification.entity';

export const entities = [
  // sec
  UserEntity,
  RoleEntity,
  AuditLogEntity,
  EmployeeEntity,
  // com
  PlanEntity,
  ClientEntity,
  AddressEntity,
  ContractEntity,
  PlanChangeRequestEntity,
  ClientNotificationEntity,
  // inv
  ProductEntity,
  SerialNumberEntity,
  StockMovementEntity,
  WarehouseEntity,
  EquipmentMovementEntity,
  StockItemEntity,
  // pos
  CashRegisterEntity,
  SaleEntity,
  SaleDetailEntity,
  InvoiceEntity,
  EcfSequenceEntity,
  DepositProofEntity,
  // tickets
  SlaPolicyEntity,
  TicketEntity,
  TicketHistoryEntity,
  TicketRepairEntity,
  ScheduleEventEntity,
  // crm
  LeadEntity,
  InteractionEntity,
];

export const databaseConfig = registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'sumtech_erp',
    entities,
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    logging: process.env.DB_LOGGING === 'true',
  }),
);

const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'sumtech_erp',
  entities,
  synchronize: false,
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
};

export const AppDataSource = new DataSource(dataSourceOptions);
