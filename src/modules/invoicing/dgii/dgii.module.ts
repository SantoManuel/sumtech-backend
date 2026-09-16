import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { DgiiSignerService } from './dgii-signer.service';
import { DgiiXmlGeneratorService } from './dgii-xml-generator.service';
import { DgiiClientService } from './dgii-client.service';
import { DgiiCertificationService } from './dgii-certification.service';
import { DgiiCertificationController } from './dgii-certification.controller';
import { DgiiB2bService } from './dgii-b2b.service';
import { 
  DgiiRecepcionB2bController, 
  DgiiAutenticacionB2bController, 
  DgiiAprobacionComercialB2bController, 
  DgiiAdminB2bController 
} from './dgii-b2b.controller';
import { DgiiReceivedInvoice } from '../entities/dgii-received-invoice.entity';
import { UsersModule } from '../../users/users.module';
import { CompanyModule } from '../../company/company.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DgiiReceivedInvoice]),
    UsersModule,
    CompanyModule,
    JwtModule.register({}),
  ],
  controllers: [
    DgiiCertificationController,
    DgiiRecepcionB2bController,
    DgiiAutenticacionB2bController,
    DgiiAprobacionComercialB2bController,
    DgiiAdminB2bController,
  ],
  providers: [
    DgiiSignerService,
    DgiiXmlGeneratorService,
    DgiiClientService,
    DgiiCertificationService,
    DgiiB2bService,
  ],
  exports: [
    DgiiSignerService,
    DgiiXmlGeneratorService,
    DgiiClientService,
    DgiiCertificationService,
    DgiiB2bService,
  ],
})
export class DgiiModule {}
