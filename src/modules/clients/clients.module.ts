import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bullmq';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { ClientsImportController } from './clients-import.controller';
import { ClientEntity } from './entities/client.entity';
import { AddressEntity } from './entities/address.entity';
import { AddressGpsRequestEntity } from './entities/address-gps-request.entity';
import { ContractEntity } from './entities/contract.entity';
import { ClientImportBatchEntity } from './entities/client-import-batch.entity';
import { ClientImportRowErrorEntity } from './entities/client-import-row-error.entity';
import { UserEntity } from '../users/entities/user.entity';
import { RoleEntity } from '../users/entities/role.entity';
import { AuditLogEntity } from '../users/entities/audit-log.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { PlanEntity } from '../plans/entities/plan.entity';
import { SectorEntity } from '../geography/entities/sector.entity';
import { MunicipalityEntity } from '../geography/entities/municipality.entity';
import { ProvinceEntity } from '../geography/entities/province.entity';
import { UsersModule } from '../users/users.module';
import { PrintingModule } from '../printing/printing.module';
import { DgiiModule } from '../invoicing/dgii/dgii.module';
import { ContractSignaturesModule } from '../contract-signatures/contract-signatures.module';
import { CompanyModule } from '../company/company.module';
import { AiChatbotClientModule } from '../ai-chatbot/ai-chatbot-client.module';
import { StorageModule } from '../storage/storage.module';
import { ClientsExportService } from './export/clients-export.service';
import { ClientsImportService, CLIENTS_IMPORT_QUEUE } from './import/clients-import.service';
import { ClientsImportProcessor } from './import/clients-import.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ClientEntity,
      AddressEntity,
      AddressGpsRequestEntity,
      ContractEntity,
      ClientImportBatchEntity,
      ClientImportRowErrorEntity,
      UserEntity,
      RoleEntity,
      AuditLogEntity,
      InvoiceEntity,
      PlanEntity,
      SectorEntity,
      MunicipalityEntity,
      ProvinceEntity,
    ]),
    BullModule.registerQueue({ name: CLIENTS_IMPORT_QUEUE }),
    UsersModule,
    PrintingModule,
    DgiiModule,
    ContractSignaturesModule,
    CompanyModule,
    AiChatbotClientModule,
    StorageModule,
    JwtModule.register({}),
  ],
  // ClientsImportController DEBE ir antes que ClientsController: registra
  // 'GET /clients/import', que colisionaría con 'GET /clients/:id' si Nest
  // lo resolviera en el orden contrario.
  controllers: [ClientsImportController, ClientsController],
  providers: [ClientsService, ClientsExportService, ClientsImportService, ClientsImportProcessor],
  exports: [ClientsService],
})
export class ClientsModule {}
