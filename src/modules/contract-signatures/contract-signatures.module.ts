import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { ContractSignatureEntity } from './entities/contract-signature.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { ContractSignaturesService } from './contract-signatures.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    // ContractEntity y TicketEntity se registran también acá (y no solo en
    // ClientsModule/TicketsModule) porque ninguno de esos dos módulos exporta
    // TenantTypeOrmModule — mismo patrón que GenieAcsModule.
    TenantTypeOrmModule.forFeature([ContractSignatureEntity, ContractEntity, TicketEntity]),
    StorageModule,
  ],
  providers: [ContractSignaturesService],
  exports: [ContractSignaturesService],
})
export class ContractSignaturesModule {}
