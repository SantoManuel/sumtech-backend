import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantConfigEntity } from './entities/tenant-config.entity';
import { CompanyService } from './company.service';
import { CompanyController } from './company.controller';
import { GeographyModule } from '../geography/geography.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantConfigEntity]),
    GeographyModule,
    JwtModule //linea de codigo escrita por ing. santo manuel 15/09/2026
  ],
  controllers: [CompanyController],
  providers: [CompanyService],
  exports: [CompanyService, TypeOrmModule],
})
export class CompanyModule {}
