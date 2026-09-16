import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractSignatureEntity } from './entities/contract-signature.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { ContractSignaturesService } from './contract-signatures.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    // ContractEntity y TicketEntity se registran también acá (y no solo en
    // ClientsModule/TicketsModule) porque ninguno de esos dos módulos exporta
    // TypeOrmModule — mismo patrón que GenieAcsModule.
    TypeOrmModule.forFeature([ContractSignatureEntity, ContractEntity, TicketEntity]),
    StorageModule,
  ],
  providers: [ContractSignaturesService],
  exports: [ContractSignaturesService],
})
export class ContractSignaturesModule {}
