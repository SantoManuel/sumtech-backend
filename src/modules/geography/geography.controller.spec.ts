import { Test, TestingModule } from '@nestjs/testing';
import { GeographyController } from './geography.controller';
import { GeographyService } from './geography.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

describe('GeographyController', () => {
  let controller: GeographyController;
  let service: GeographyService;

  beforeEach(async () => {
    const mockGeographyService = {
      findAllCountries: jest.fn().mockResolvedValue([{ id: 'c-1', name: 'República Dominicana' }]),
      findCountryById: jest.fn().mockResolvedValue({ id: 'c-1', name: 'República Dominicana' }),
      findProvinces: jest.fn().mockResolvedValue([{ id: 'p-1', name: 'Distrito Nacional' }]),
      findMunicipalities: jest.fn().mockResolvedValue([{ id: 'm-1', name: 'Santo Domingo de Guzmán' }]),
      findSectors: jest.fn().mockResolvedValue([{ id: 's-1', name: 'Piantini' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GeographyController],
      providers: [
        { provide: GeographyService, useValue: mockGeographyService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: UsersService, useValue: { findById: jest.fn() } },
      ],
    }).compile();

    controller = module.get<GeographyController>(GeographyController);
    service = module.get<GeographyService>(GeographyService);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('getCountries debe llamar a findAllCountries', async () => {
    const result = await controller.getCountries();
    expect(result).toHaveLength(1);
    expect(service.findAllCountries).toHaveBeenCalledWith(true);
  });

  it('getProvinces debe llamar a findProvinces con filtro', async () => {
    const result = await controller.getProvinces({ countryId: 'c-1' });
    expect(result).toHaveLength(1);
    expect(service.findProvinces).toHaveBeenCalledWith({ countryId: 'c-1' });
  });

  it('getMunicipalities debe llamar a findMunicipalities con filtro', async () => {
    const result = await controller.getMunicipalities({ provinceId: 'p-1' });
    expect(result).toHaveLength(1);
    expect(service.findMunicipalities).toHaveBeenCalledWith({ provinceId: 'p-1' });
  });

  it('getSectors debe llamar a findSectors con filtro', async () => {
    const result = await controller.getSectors({ municipalityId: 'm-1' });
    expect(result).toHaveLength(1);
    expect(service.findSectors).toHaveBeenCalledWith({ municipalityId: 'm-1' });
  });
});
