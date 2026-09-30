import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { CoordinationService } from './coordination.service';
import { ContractEntity } from '../clients/entities/contract.entity';

@Module({
  imports: [TenantTypeOrmModule.forFeature([ContractEntity])],
  providers: [CoordinationService],
  exports: [CoordinationService],
})
export class CoordinationModule {}
