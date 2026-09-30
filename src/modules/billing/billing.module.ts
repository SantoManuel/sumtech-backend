import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { JwtModule } from '@nestjs/jwt';
import { ContractEntity } from '../clients/entities/contract.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { BillingSettingsEntity } from './entities/billing-settings.entity';
import { SuspensionHistoryEntity } from './entities/suspension-history.entity';
import { NetworkAccessEntity } from '../network/entities/network-access.entity';
import { BillingCycleService } from './billing-cycle.service';
import { BillingSettingsService } from './billing-settings.service';
import { MorosidadService } from './morosidad.service';
import { SuspensionHistoryService } from './suspension-history.service';
import { BillingReactivationListener } from './listeners/billing-reactivation.listener';
import { BillingController } from './billing.controller';
import { UsersModule } from '../users/users.module';
import { NetworkModule } from '../network/network.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      ContractEntity,
      InvoiceEntity,
      BillingSettingsEntity,
      SuspensionHistoryEntity,
      NetworkAccessEntity,
    ]),
    UsersModule,
    NetworkModule,
    JwtModule.register({}),
  ],
  controllers: [BillingController],
  providers: [
    BillingCycleService,
    BillingSettingsService,
    MorosidadService,
    SuspensionHistoryService,
    BillingReactivationListener,
  ],
  exports: [BillingCycleService, BillingSettingsService, MorosidadService, SuspensionHistoryService],
})
export class BillingModule {}
