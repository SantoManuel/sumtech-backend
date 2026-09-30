import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { JwtModule } from '@nestjs/jwt';
import { PosService } from './pos.service';
import { PosController } from './pos.controller';
import { SaleEntity } from './entities/sale.entity';
import { SaleDetailEntity } from './entities/sale-detail.entity';
import { CashRegisterEntity } from './entities/cash-register.entity';
import { CashStationEntity } from './entities/cash-station.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { ClientEntity } from '../clients/entities/client.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { EmployeeEntity } from '../employees/entities/employee.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { BillingModule } from '../billing/billing.module';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      SaleEntity,
      SaleDetailEntity,
      CashRegisterEntity,
      CashStationEntity,
      ContractEntity,
      ClientEntity,
      InvoiceEntity,
      EmployeeEntity,
    ]),
    InventoryModule,
    InvoicingModule,
    BillingModule,
    UsersModule,
    AuthModule,
    JwtModule.register({}),
  ],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
