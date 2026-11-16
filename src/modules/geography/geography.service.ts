import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CountryEntity } from './entities/country.entity';
import { ProvinceEntity } from './entities/province.entity';
import { MunicipalityEntity } from './entities/municipality.entity';
import { SectorEntity } from './entities/sector.entity';
import { AddressEntity } from '../clients/entities/address.entity';
import {
  FilterProvinceDto,
  FilterMunicipalityDto,
  FilterSectorDto,
  CreateSectorDto,
  UpdateSectorDto,
  CreateMunicipalityDto,
  UpdateMunicipalityDto,
} from './dto/geography.dto';

export interface SectorWithStats extends SectorEntity {
  subscriberCount: number;
}

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
    @InjectRepository(AddressEntity)
    private readonly addressRepository: Repository<AddressEntity>,
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
      throw new NotFoundException(`País con ID ${id} no encontrado`);
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
    if (filter.provinceId) {
      qb.innerJoin('s.municipality', 'm');
      qb.andWhere('m.provinceId = :provinceId', { provinceId: filter.provinceId });
    }
    if (filter.search) {
      qb.andWhere('(s.name ILIKE :search OR s.postalCode ILIKE :search)', { search: `%${filter.search}%` });
    }
    if (filter.activeOnly !== false) {
      qb.andWhere('s.isActive = true');
    }
    return qb.orderBy('s.name', 'ASC').getMany();
  }

  /**
   * Obtiene la lista de sectores con conteo de suscriptores asociados en com.addresses
   */
  async findSectorsWithStats(filter: FilterSectorDto): Promise<SectorWithStats[]> {
    const qb = this.sectorRepository
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.municipality', 'm')
      .leftJoinAndSelect('m.province', 'p');

    if (filter.municipalityId) {
      qb.andWhere('s.municipalityId = :municipalityId', { municipalityId: filter.municipalityId });
    }
    if (filter.provinceId) {
      qb.andWhere('m.provinceId = :provinceId', { provinceId: filter.provinceId });
    }
    if (filter.search) {
      qb.andWhere('(s.name ILIKE :search OR s.postalCode ILIKE :search)', { search: `%${filter.search}%` });
    }
    if (filter.activeOnly === true || (filter.activeOnly as any) === 'true') {
      qb.andWhere('s.isActive = true');
    }

    const sectors = await qb.orderBy('s.name', 'ASC').getMany();

    if (sectors.length === 0) {
      return [];
    }

    const sectorIds = sectors.map((s) => s.id);
    const countResults = await this.addressRepository
      .createQueryBuilder('a')
      .select('a.sectorId', 'sectorId')
      .addSelect('COUNT(a.id)', 'count')
      .where('a.sectorId IN (:...sectorIds)', { sectorIds })
      .groupBy('a.sectorId')
      .getRawMany();

    const countMap = new Map<string, number>();
    for (const r of countResults) {
      countMap.set(r.sectorId, parseInt(r.count, 10));
    }

    return sectors.map((s) => ({
      ...s,
      subscriberCount: countMap.get(s.id) || 0,
    }));
  }

  /**
   * Da de alta un nuevo sector/barrio verificando que no exista duplicado en el municipio
   */
  async createSector(dto: CreateSectorDto): Promise<SectorEntity> {
    const municipality = await this.municipalityRepository.findOne({
      where: { id: dto.municipalityId },
      relations: ['province'],
    });

    if (!municipality) {
      throw new NotFoundException(`Municipio con ID ${dto.municipalityId} no encontrado`);
    }

    const trimmedName = dto.name.trim();

    const existing = await this.sectorRepository
      .createQueryBuilder('s')
      .where('s.municipalityId = :municipalityId', { municipalityId: dto.municipalityId })
      .andWhere('LOWER(TRIM(s.name)) = LOWER(:name)', { name: trimmedName })
      .getOne();

    if (existing) {
      throw new ConflictException(
        `Ya existe el sector o barrio "${trimmedName}" en el municipio "${municipality.name}".`,
      );
    }

    const sector = this.sectorRepository.create({
      municipalityId: dto.municipalityId,
      name: trimmedName,
      postalCode: dto.postalCode?.trim() || municipality.postalCode || undefined,
      isActive: true,
    });

    const saved = await this.sectorRepository.save(sector);
    saved.municipality = municipality;
    return saved;
  }

  /**
   * Actualiza un sector (nombre, código postal o estado activo)
   */
  async updateSector(id: string, dto: UpdateSectorDto): Promise<SectorEntity> {
    const sector = await this.sectorRepository.findOne({
      where: { id },
      relations: ['municipality', 'municipality.province'],
    });

    if (!sector) {
      throw new NotFoundException(`Sector con ID ${id} no encontrado`);
    }

    if (dto.name && dto.name.trim().toLowerCase() !== sector.name.toLowerCase()) {
      const trimmedName = dto.name.trim();
      const collision = await this.sectorRepository
        .createQueryBuilder('s')
        .where('s.municipalityId = :municipalityId', { municipalityId: sector.municipalityId })
        .andWhere('LOWER(TRIM(s.name)) = LOWER(:name)', { name: trimmedName })
        .andWhere('s.id != :id', { id })
        .getOne();

      if (collision) {
        throw new ConflictException(
          `Ya existe otro sector con el nombre "${trimmedName}" en el municipio "${sector.municipality.name}".`,
        );
      }
      sector.name = trimmedName;
    }

    if (dto.postalCode !== undefined) {
      sector.postalCode = dto.postalCode ? dto.postalCode.trim() : undefined;
    }

    if (dto.isActive !== undefined) {
      sector.isActive = dto.isActive;
    }

    return this.sectorRepository.save(sector);
  }

  /**
   * Elimina un sector físicamente si no tiene suscriptores, o advierte conflicto
   */
  async deleteSector(id: string): Promise<{ success: boolean; message: string }> {
    const sector = await this.sectorRepository.findOne({
      where: { id },
      relations: ['municipality'],
    });

    if (!sector) {
      throw new NotFoundException(`Sector con ID ${id} no encontrado`);
    }

    const subscriberCount = await this.addressRepository.count({
      where: { sectorId: id },
    });

    if (subscriberCount > 0) {
      throw new ConflictException(
        `No se puede eliminar el sector "${sector.name}" porque tiene ${subscriberCount} domicilio(s) o suscriptor(es) asignado(s). Puede desactivarlo para que no aparezca en nuevas contrataciones.`,
      );
    }

    await this.sectorRepository.remove(sector);
    return {
      success: true,
      message: `El sector "${sector.name}" ha sido eliminado exitosamente.`,
    };
  }

  /**
   * Da de alta un nuevo municipio en una provincia
   */
  async createMunicipality(dto: CreateMunicipalityDto): Promise<MunicipalityEntity> {
    const province = await this.provinceRepository.findOne({
      where: { id: dto.provinceId },
    });

    if (!province) {
      throw new NotFoundException(`Provincia con ID ${dto.provinceId} no encontrada`);
    }

    const trimmedName = dto.name.trim();

    const existing = await this.municipalityRepository
      .createQueryBuilder('m')
      .where('m.provinceId = :provinceId', { provinceId: dto.provinceId })
      .andWhere('LOWER(TRIM(m.name)) = LOWER(:name)', { name: trimmedName })
      .getOne();

    if (existing) {
      throw new ConflictException(
        `Ya existe el municipio "${trimmedName}" en la provincia "${province.name}".`,
      );
    }

    const municipality = this.municipalityRepository.create({
      provinceId: dto.provinceId,
      name: trimmedName,
      code: dto.code?.trim() || undefined,
      postalCode: dto.postalCode?.trim() || undefined,
      isActive: true,
    });

    const saved = await this.municipalityRepository.save(municipality);
    saved.province = province;
    return saved;
  }

  /**
   * Actualiza un municipio
   */
  async updateMunicipality(id: string, dto: UpdateMunicipalityDto): Promise<MunicipalityEntity> {
    const municipality = await this.municipalityRepository.findOne({
      where: { id },
      relations: ['province'],
    });

    if (!municipality) {
      throw new NotFoundException(`Municipio con ID ${id} no encontrado`);
    }

    if (dto.name && dto.name.trim().toLowerCase() !== municipality.name.toLowerCase()) {
      const trimmedName = dto.name.trim();
      const collision = await this.municipalityRepository
        .createQueryBuilder('m')
        .where('m.provinceId = :provinceId', { provinceId: municipality.provinceId })
        .andWhere('LOWER(TRIM(m.name)) = LOWER(:name)', { name: trimmedName })
        .andWhere('m.id != :id', { id })
        .getOne();

      if (collision) {
        throw new ConflictException(
          `Ya existe otro municipio con el nombre "${trimmedName}" en la provincia "${municipality.province.name}".`,
        );
      }
      municipality.name = trimmedName;
    }

    if (dto.code !== undefined) {
      municipality.code = dto.code ? dto.code.trim() : undefined;
    }

    if (dto.postalCode !== undefined) {
      municipality.postalCode = dto.postalCode ? dto.postalCode.trim() : undefined;
    }

    if (dto.isActive !== undefined) {
      municipality.isActive = dto.isActive;
    }

    return this.municipalityRepository.save(municipality);
  }
}
