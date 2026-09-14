import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PosService } from './pos.service';
import { PosController } from './pos.controller';
import { SaleEntity } from './entities/sale.entity';
import { SaleDetailEntity } from './entities/sale-detail.entity';
import { CashRegisterEntity } from './entities/cash-register.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { ClientEntity } from '../clients/entities/client.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { BillingModule } from '../billing/billing.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SaleEntity,
      SaleDetailEntity,
      CashRegisterEntity,
      ContractEntity,
      ClientEntity,
      InvoiceEntity,
    ]),
    InventoryModule,
    InvoicingModule,
    BillingModule,
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
