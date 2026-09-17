import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { DgiiSignerService } from './dgii-signer.service';
import { DgiiXsdValidatorService } from './dgii-xsd-validator.service';
import { DgiiXmlGeneratorService } from './dgii-xml-generator.service';
import { DgiiClientService } from './dgii-client.service';
import { DgiiCertificationService } from './dgii-certification.service';
import { DgiiCertificationController } from './dgii-certification.controller';
import { DgiiTestSetImportService } from './dgii-testset-import.service';
import { DgiiB2bService } from './dgii-b2b.service';
import { 
  DgiiRecepcionB2bController, 
  DgiiAutenticacionB2bController, 
  DgiiAprobacionComercialB2bController, 
  DgiiAdminB2bController 
} from './dgii-b2b.controller';
import { DgiiReceivedInvoice } from '../entities/dgii-received-invoice.entity';
import { DgiiCertificationRun } from './entities/dgii-certification-run.entity';
import { UsersModule } from '../../users/users.module';
import { CompanyModule } from '../../company/company.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DgiiReceivedInvoice, DgiiCertificationRun]),
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
    DgiiXsdValidatorService,
    DgiiClientService,
    DgiiCertificationService,
    DgiiTestSetImportService,
    DgiiB2bService,
  ],
  exports: [
    DgiiSignerService,
    DgiiXmlGeneratorService,
    DgiiXsdValidatorService,
    DgiiClientService,
    DgiiCertificationService,
    DgiiTestSetImportService,
    DgiiB2bService,
  ],
})
export class DgiiModule {}
