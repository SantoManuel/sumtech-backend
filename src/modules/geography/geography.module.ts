import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
    TypeOrmModule.forFeature([
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
  exports: [GeographyService, TypeOrmModule],
})
export class GeographyModule {}
