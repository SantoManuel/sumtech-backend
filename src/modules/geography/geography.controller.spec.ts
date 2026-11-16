import { Test, TestingModule } from '@nestjs/testing';
import { GeographyController } from './geography.controller';
import { GeographyService } from './geography.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';
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
      createMunicipality: jest.fn().mockResolvedValue({ id: 'm-2', name: 'Peralta' }),
      updateMunicipality: jest.fn().mockResolvedValue({ id: 'm-2', name: 'Peralta Modificado' }),
      findSectors: jest.fn().mockResolvedValue([{ id: 's-1', name: 'Piantini' }]),
      findSectorsWithStats: jest.fn().mockResolvedValue([{ id: 's-1', name: 'Piantini', subscriberCount: 5 }]),
      createSector: jest.fn().mockResolvedValue({ id: 's-2', name: 'Barrio Quisqueya' }),
      updateSector: jest.fn().mockResolvedValue({ id: 's-2', name: 'Barrio Quisqueya Actualizado' }),
      deleteSector: jest.fn().mockResolvedValue({ success: true, message: 'Sector eliminado' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GeographyController],
      providers: [
        { provide: GeographyService, useValue: mockGeographyService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: TenantContextService, useValue: { hasContext: jest.fn().mockReturnValue(false), getTenantId: jest.fn(), getSlug: jest.fn() } },
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

  it('createMunicipality debe invocar al servicio', async () => {
    const result = await controller.createMunicipality({ provinceId: 'p-1', name: 'Peralta' });
    expect(result.name).toBe('Peralta');
    expect(service.createMunicipality).toHaveBeenCalled();
  });

  it('updateMunicipality debe invocar al servicio', async () => {
    const result = await controller.updateMunicipality('m-2', { name: 'Peralta Modificado' });
    expect(result.name).toBe('Peralta Modificado');
    expect(service.updateMunicipality).toHaveBeenCalledWith('m-2', { name: 'Peralta Modificado' });
  });

  it('getSectors debe llamar a findSectors con filtro', async () => {
    const result = await controller.getSectors({ municipalityId: 'm-1' });
    expect(result).toHaveLength(1);
    expect(service.findSectors).toHaveBeenCalledWith({ municipalityId: 'm-1' });
  });

  it('getSectorsWithStats debe llamar a findSectorsWithStats', async () => {
    const result = await controller.getSectorsWithStats({ municipalityId: 'm-1' });
    expect(result).toHaveLength(1);
    expect(result[0].subscriberCount).toBe(5);
    expect(service.findSectorsWithStats).toHaveBeenCalledWith({ municipalityId: 'm-1' });
  });

  it('createSector debe invocar al servicio', async () => {
    const result = await controller.createSector({ municipalityId: 'm-1', name: 'Barrio Quisqueya' });
    expect(result.name).toBe('Barrio Quisqueya');
    expect(service.createSector).toHaveBeenCalled();
  });

  it('updateSector debe invocar al servicio', async () => {
    const result = await controller.updateSector('s-2', { name: 'Barrio Quisqueya Actualizado' });
    expect(result.name).toBe('Barrio Quisqueya Actualizado');
    expect(service.updateSector).toHaveBeenCalledWith('s-2', { name: 'Barrio Quisqueya Actualizado' });
  });

  it('deleteSector debe invocar al servicio', async () => {
    const result = await controller.deleteSector('s-2');
    expect(result.success).toBe(true);
    expect(service.deleteSector).toHaveBeenCalledWith('s-2');
  });
});
