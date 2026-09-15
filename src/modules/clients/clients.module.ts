import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { ClientEntity } from './entities/client.entity';
import { AddressEntity } from './entities/address.entity';
import { AddressGpsRequestEntity } from './entities/address-gps-request.entity';
import { ContractEntity } from './entities/contract.entity';
import { UserEntity } from '../users/entities/user.entity';
import { RoleEntity } from '../users/entities/role.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { PlanEntity } from '../plans/entities/plan.entity';
import { SectorEntity } from '../geography/entities/sector.entity';
import { UsersModule } from '../users/users.module';
import { PrintingModule } from '../printing/printing.module';
import { DgiiModule } from '../invoicing/dgii/dgii.module';
import { ContractSignaturesModule } from '../contract-signatures/contract-signatures.module';
import { CompanyModule } from '../company/company.module';
import { AiChatbotClientModule } from '../ai-chatbot/ai-chatbot-client.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ClientEntity,
      AddressEntity,
      AddressGpsRequestEntity,
      ContractEntity,
      UserEntity,
      RoleEntity,
      InvoiceEntity,
      PlanEntity,
      SectorEntity,
    ]),
    UsersModule,
    PrintingModule,
    DgiiModule,
    ContractSignaturesModule,
    CompanyModule,
    AiChatbotClientModule,
    JwtModule.register({}),
  ],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
