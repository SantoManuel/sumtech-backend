import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CountryEntity } from './entities/country.entity';
import { ProvinceEntity } from './entities/province.entity';
import { MunicipalityEntity } from './entities/municipality.entity';
import { SectorEntity } from './entities/sector.entity';
import { FilterProvinceDto, FilterMunicipalityDto, FilterSectorDto } from './dto/geography.dto';

@Injectable()
export class GeographyService {
  constructor(
    @InjectRepository(CountryEntity)
    private readonly countryRepository: Repository<CountryEntity>,
    @InjectRepository(ProvinceEntity)
    private readonly provinceRepository: Repository<ProvinceEntity>,
    @InjectRepository(MunicipalityEntity)
    private readonly municipalityRepository: Repository<MunicipalityEntity>,
    @InjectRepository(SectorEntity)
    private readonly sectorRepository: Repository<SectorEntity>,
  ) {}

  async findAllCountries(activeOnly = true): Promise<CountryEntity[]> {
    const where = activeOnly ? { isActive: true } : {};
    return this.countryRepository.find({
      where,
      order: { name: 'ASC' },
    });
  }

  async findCountryById(id: string): Promise<CountryEntity> {
    const country = await this.countryRepository.findOneBy({ id });
    if (!country) {
      throw new NotFoundException(`País ${id} no encontrado`);
    }
    return country;
  }

  async findProvinces(filter: FilterProvinceDto): Promise<ProvinceEntity[]> {
    const qb = this.provinceRepository.createQueryBuilder('p');
    if (filter.countryId) {
      qb.andWhere('p.countryId = :countryId', { countryId: filter.countryId });
    }
    if (filter.activeOnly !== false) {
      qb.andWhere('p.isActive = true');
    }
    return qb.orderBy('p.name', 'ASC').getMany();
  }

  async findMunicipalities(filter: FilterMunicipalityDto): Promise<MunicipalityEntity[]> {
    const qb = this.municipalityRepository.createQueryBuilder('m');
    if (filter.provinceId) {
      qb.andWhere('m.provinceId = :provinceId', { provinceId: filter.provinceId });
    }
    if (filter.activeOnly !== false) {
      qb.andWhere('m.isActive = true');
    }
    return qb.orderBy('m.name', 'ASC').getMany();
  }

  async findSectors(filter: FilterSectorDto): Promise<SectorEntity[]> {
    const qb = this.sectorRepository.createQueryBuilder('s');
    if (filter.municipalityId) {
      qb.andWhere('s.municipalityId = :municipalityId', { municipalityId: filter.municipalityId });
    }
    if (filter.search) {
      qb.andWhere('s.name ILIKE :search', { search: `%${filter.search}%` });
    }
    if (filter.activeOnly !== false) {
      qb.andWhere('s.isActive = true');
    }
    return qb.orderBy('s.name', 'ASC').getMany();
  }
}
