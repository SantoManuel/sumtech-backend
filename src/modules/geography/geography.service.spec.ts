import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GeographyService } from './geography.service';
import { CountryEntity } from './entities/country.entity';
import { ProvinceEntity } from './entities/province.entity';
import { MunicipalityEntity } from './entities/municipality.entity';
import { SectorEntity } from './entities/sector.entity';

describe('GeographyService', () => {
  let service: GeographyService;
  let countryRepo: any;
  let provinceRepo: any;
  let municipalityRepo: any;
  let sectorRepo: any;

  beforeEach(async () => {
    countryRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'c-1', code: 'DOM', name: 'República Dominicana' }]),
      findOneBy: jest.fn().mockResolvedValue({ id: 'c-1', code: 'DOM', name: 'República Dominicana' }),
    };

    const mockQueryBuilder = (result: any[]) => ({
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(result),
    });

    provinceRepo = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder([{ id: 'p-1', name: 'Distrito Nacional' }])),
    };

    municipalityRepo = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder([{ id: 'm-1', name: 'Santo Domingo de Guzmán' }])),
    };

    sectorRepo = {
      createQueryBuilder: jest.fn(() => mockQueryBuilder([{ id: 's-1', name: 'Piantini' }])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeographyService,
        { provide: getRepositoryToken(CountryEntity), useValue: countryRepo },
        { provide: getRepositoryToken(ProvinceEntity), useValue: provinceRepo },
        { provide: getRepositoryToken(MunicipalityEntity), useValue: municipalityRepo },
        { provide: getRepositoryToken(SectorEntity), useValue: sectorRepo },
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
    const municipalities = await service.findMunicipalities({ provinceId: 'p-1' });
    expect(municipalities).toHaveLength(1);
    expect(municipalityRepo.createQueryBuilder).toHaveBeenCalled();
  });

  it('debe listar sectores filtrados por municipio', async () => {
    const sectors = await service.findSectors({ municipalityId: 'm-1' });
    expect(sectors).toHaveLength(1);
    expect(sectorRepo.createQueryBuilder).toHaveBeenCalled();
  });
});
