import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { CompanyProfileEntity } from './entities/company-profile.entity';
import { NetworkAccessEntity } from '../network/entities/network-access.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { CompanyService } from './company.service';
import { CompanyController } from './company.controller';
import { SuspensionPortalService } from './suspension-portal.service';
import { SuspensionPortalController } from './suspension-portal.controller';
import { GeographyModule } from '../geography/geography.module';
import { StorageModule } from '../storage/storage.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      CompanyProfileEntity,
      NetworkAccessEntity,
      ContractEntity,
      InvoiceEntity,
    ]),
    GeographyModule,
    StorageModule,
    JwtModule,
  ],
  controllers: [CompanyController, SuspensionPortalController],
  providers: [CompanyService, SuspensionPortalService],
  exports: [CompanyService, SuspensionPortalService, TenantTypeOrmModule],
})
export class CompanyModule {}
