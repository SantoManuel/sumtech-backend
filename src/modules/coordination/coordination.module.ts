import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoordinationService } from './coordination.service';
import { ContractEntity } from '../clients/entities/contract.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ContractEntity])],
  providers: [CoordinationService],
  exports: [CoordinationService],
})
export class CoordinationModule {}
