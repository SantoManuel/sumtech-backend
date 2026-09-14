import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ContractEntity } from '../clients/entities/contract.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { BillingSettingsEntity } from './entities/billing-settings.entity';
import { BillingCycleService } from './billing-cycle.service';
import { BillingSettingsService } from './billing-settings.service';
import { MorosidadService } from './morosidad.service';
import { BillingController } from './billing.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ContractEntity, InvoiceEntity, BillingSettingsEntity]),
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [BillingController],
  providers: [BillingCycleService, BillingSettingsService, MorosidadService],
  exports: [BillingCycleService, BillingSettingsService, MorosidadService],
})
export class BillingModule {}
