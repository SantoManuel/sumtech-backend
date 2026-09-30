import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { JwtModule } from '@nestjs/jwt';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { TicketEntity } from './entities/ticket.entity';
import { TicketHistoryEntity } from './entities/ticket-history.entity';
import { TicketRepairEntity } from './entities/ticket-repair.entity';
import { SlaPolicyEntity } from './entities/sla-policy.entity';
import { ScheduleEventEntity } from './entities/schedule-event.entity';
import { ScheduleEventsService } from './schedule-events.service';
import { ScheduleEventsController } from './schedule-events.controller';
import { ContractCreatedListener } from './listeners/contract-created.listener';
import { InventoryModule } from '../inventory/inventory.module';
import { UsersModule } from '../users/users.module';
import { AddressEntity } from '../clients/entities/address.entity';
import { ContractEntity } from '../clients/entities/contract.entity';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      TicketEntity,
      TicketHistoryEntity,
      TicketRepairEntity,
      SlaPolicyEntity,
      ScheduleEventEntity,
      AddressEntity,
      ContractEntity,
    ]),
    InventoryModule,
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [TicketsController, ScheduleEventsController],
  providers: [TicketsService, ScheduleEventsService, ContractCreatedListener],
  exports: [TicketsService, ScheduleEventsService],
})
export class TicketsModule {}
