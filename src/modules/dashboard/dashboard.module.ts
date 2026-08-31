import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ClientEntity } from '../clients/entities/client.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { SaleEntity } from '../pos/entities/sale.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { ProductEntity } from '../inventory/entities/product.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ClientEntity,
      ContractEntity,
      SaleEntity,
      InvoiceEntity,
      TicketEntity,
      ProductEntity,
      SerialNumberEntity,
    ]),
    JwtModule.register({}),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
