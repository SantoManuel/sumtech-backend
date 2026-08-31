import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { InvoicingService } from './invoicing.service';
import { InvoicingController } from './invoicing.controller';
import { InvoiceEntity } from './entities/invoice.entity';
import { EcfSequenceEntity } from './entities/ecf-sequence.entity';
import { SaleEntity } from '../pos/entities/sale.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { ProductEntity } from '../inventory/entities/product.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { ClientEntity } from '../clients/entities/client.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { PlanEntity } from '../plans/entities/plan.entity';
import { DgiiModule } from './dgii/dgii.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InvoiceEntity,
      EcfSequenceEntity,
      SaleEntity,
      TicketEntity,
      ProductEntity,
      SerialNumberEntity,
      ClientEntity,
      ContractEntity,
      PlanEntity,
    ]),
    DgiiModule,
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [InvoicingController],
  providers: [InvoicingService],
  exports: [InvoicingService, DgiiModule],
})
export class InvoicingModule {}
