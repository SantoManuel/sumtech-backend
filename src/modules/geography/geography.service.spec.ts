import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { GeographyService } from './geography.service';
import { CountryEntity } from './entities/country.entity';
import { ProvinceEntity } from './entities/province.entity';
import { MunicipalityEntity } from './entities/municipality.entity';
import { SectorEntity } from './entities/sector.entity';
import { AddressEntity } from '../clients/entities/address.entity';

describe('GeographyService', () => {
  let service: GeographyService;
  let countryRepo: any;
  let provinceRepo: any;
  let municipalityRepo: any;
  let sectorRepo: any;
  let addressRepo: any;

  beforeEach(async () => {
    countryRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'c-1', code: 'DOM', name: 'República Dominicana' }]),
      findOneBy: jest.fn().mockResolvedValue({ id: 'c-1', code: 'DOM', name: 'República Dominicana' }),
    };

    const mockQueryBuilder = (result: any[] = []) => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(result),
      getOne: jest.fn().mockResolvedValue(result[0] || null),
      getRawAndEntities: jest.fn().mockResolvedValue({
        entities: result,
        raw: result.map(() => ({ subscriber_count: '5' })),
      }),
    });

    provinceRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'p-1', name: 'Azua' }),
      createQueryBuilder: jest.fn(() => mockQueryBuilder([{ id: 'p-1', name: 'Azua' }])),
    };

    municipalityRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'm-1', name: 'Azua de Compostela', postalCode: '71000' }),
      createQueryBuilder: jest.fn(() => mockQueryBuilder([])),
      create: jest.fn((dto) => ({ id: 'm-new', ...dto })),
      save: jest.fn((entity) => Promise.resolve({ id: entity.id || 'm-new', ...entity })),
    };

    sectorRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 's-1',
        name: 'Alto de las Flores',
        municipalityId: 'm-1',
        municipality: { id: 'm-1', name: 'Azua de Compostela' },
      }),
      createQueryBuilder: jest.fn(() => mockQueryBuilder([])),
      create: jest.fn((dto) => ({ id: 's-new', ...dto })),
      save: jest.fn((entity) => Promise.resolve({ id: entity.id || 's-new', ...entity })),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    addressRepo = {
      count: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeographyService,
        { provide: getRepositoryToken(CountryEntity), useValue: countryRepo },
        { provide: getRepositoryToken(ProvinceEntity), useValue: provinceRepo },
        { provide: getRepositoryToken(MunicipalityEntity), useValue: municipalityRepo },
        { provide: getRepositoryToken(SectorEntity), useValue: sectorRepo },
        { provide: getRepositoryToken(AddressEntity), useValue: addressRepo },
      ],
    }).compile();

    service = module.get<GeographyService>(GeographyService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debe listar países', async () => {
    const countries = await service.findAllCountries();
    expect(countries).toHaveLength(1);
    expect(countryRepo.find).toHaveBeenCalled();
  });

  it('debe listar provincias filtradas por país', async () => {
    const provinces = await service.findProvinces({ countryId: 'c-1' });
    expect(provinces).toHaveLength(1);
    expect(provinceRepo.createQueryBuilder).toHaveBeenCalled();
  });

  it('debe listar municipios filtrados por provincia', async () => {
    municipalityRepo.createQueryBuilder.mockReturnValue({
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: 'm-1', name: 'Azua de Compostela' }]),
    });
    const municipalities = await service.findMunicipalities({ provinceId: 'p-1' });
    expect(municipalities).toHaveLength(1);
    expect(municipalityRepo.createQueryBuilder).toHaveBeenCalled();
  });

  it('debe listar sectores filtrados por municipio', async () => {
    sectorRepo.createQueryBuilder.mockReturnValue({
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: 's-1', name: 'Alto de las Flores' }]),
    });
    const sectors = await service.findSectors({ municipalityId: 'm-1' });
    expect(sectors).toHaveLength(1);
    expect(sectorRepo.createQueryBuilder).toHaveBeenCalled();
  });

  it('debe listar sectores con estadísticas de suscriptores', async () => {
    sectorRepo.createQueryBuilder.mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawAndEntities: jest.fn().mockResolvedValue({
        entities: [{ id: 's-1', name: 'Alto de las Flores' }],
        raw: [{ subscriber_count: '12' }],
      }),
    });

    const sectorsWithStats = await service.findSectorsWithStats({ municipalityId: 'm-1' });
    expect(sectorsWithStats).toHaveLength(1);
    expect(sectorsWithStats[0].subscriberCount).toBe(12);
  });

  describe('createSector', () => {
    it('debe crear un nuevo sector exitosamente', async () => {
      sectorRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      const result = await service.createSector({
        municipalityId: 'm-1',
        name: 'Barrio Quisqueya',
        postalCode: '71001',
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('Barrio Quisqueya');
      expect(sectorRepo.save).toHaveBeenCalled();
    });

    it('debe lanzar NotFoundException si el municipio no existe', async () => {
      municipalityRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createSector({
          municipalityId: 'm-invalid',
          name: 'Barrio Quisqueya',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe lanzar ConflictException si el sector ya existe en el municipio', async () => {
      sectorRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 's-existing', name: 'Alto de las Flores' }),
      });

      await expect(
        service.createSector({
          municipalityId: 'm-1',
          name: 'Alto de las Flores',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateSector', () => {
    it('debe actualizar el sector exitosamente', async () => {
      sectorRepo.findOne.mockResolvedValue({
        id: 's-1',
        name: 'Alto de las Flores',
        municipalityId: 'm-1',
        municipality: { id: 'm-1', name: 'Azua de Compostela' },
      });

      sectorRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      const updated = await service.updateSector('s-1', {
        name: 'Alto de las Flores Modificado',
        postalCode: '71002',
        isActive: false,
      });

      expect(updated.name).toBe('Alto de las Flores Modificado');
      expect(sectorRepo.save).toHaveBeenCalled();
    });

    it('debe lanzar ConflictException si el nuevo nombre colisiona con otro sector', async () => {
      sectorRepo.findOne.mockResolvedValue({
        id: 's-1',
        name: 'Alto de las Flores',
        municipalityId: 'm-1',
        municipality: { id: 'm-1', name: 'Azua de Compostela' },
      });

      sectorRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 's-2', name: 'Barrio Quisqueya' }),
      });

      await expect(
        service.updateSector('s-1', { name: 'Barrio Quisqueya' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteSector', () => {
    it('debe eliminar físicamente el sector si tiene 0 suscriptores', async () => {
      addressRepo.count.mockResolvedValue(0);

      const result = await service.deleteSector('s-1');
      expect(result.success).toBe(true);
      expect(sectorRepo.remove).toHaveBeenCalled();
    });

    it('debe rechazar eliminación con ConflictException si tiene suscriptores asociados', async () => {
      addressRepo.count.mockResolvedValue(15);

      await expect(service.deleteSector('s-1')).rejects.toThrow(ConflictException);
      expect(sectorRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('createMunicipality', () => {
    it('debe crear un nuevo municipio exitosamente', async () => {
      municipalityRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });

      const result = await service.createMunicipality({
        provinceId: 'p-1',
        name: 'Peralta',
        postalCode: '71000',
      });

      expect(result.name).toBe('Peralta');
      expect(municipalityRepo.save).toHaveBeenCalled();
    });

    it('debe lanzar ConflictException si el municipio ya existe en la provincia', async () => {
      municipalityRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'm-existing', name: 'Azua de Compostela' }),
      });

      await expect(
        service.createMunicipality({
          provinceId: 'p-1',
          name: 'Azua de Compostela',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
