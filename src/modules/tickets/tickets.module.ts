import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { SaleConfirmedListener } from './listeners/sale-confirmed.listener';
import { InventoryModule } from '../inventory/inventory.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TicketEntity,
      TicketHistoryEntity,
      TicketRepairEntity,
      SlaPolicyEntity,
      ScheduleEventEntity,
    ]),
    InventoryModule,
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [TicketsController, ScheduleEventsController],
  providers: [TicketsService, ScheduleEventsService, SaleConfirmedListener],
  exports: [TicketsService, ScheduleEventsService],
})
export class TicketsModule {}
