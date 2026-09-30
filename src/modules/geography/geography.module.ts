import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { JwtModule } from '@nestjs/jwt';
import { CountryEntity } from './entities/country.entity';
import { ProvinceEntity } from './entities/province.entity';
import { MunicipalityEntity } from './entities/municipality.entity';
import { SectorEntity } from './entities/sector.entity';
import { GeographyService } from './geography.service';
import { GeographyController } from './geography.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      CountryEntity,
      ProvinceEntity,
      MunicipalityEntity,
      SectorEntity,
    ]),
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [GeographyController],
  providers: [GeographyService],
  exports: [GeographyService, TenantTypeOrmModule],
})
export class GeographyModule {}
