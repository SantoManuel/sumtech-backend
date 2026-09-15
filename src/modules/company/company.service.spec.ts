import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { CompanyService } from './company.service';
import { TenantConfigEntity } from './entities/tenant-config.entity';

describe('CompanyService', () => {
  let service: CompanyService;
  let tenantRepo: any;
  let dataSource: any;
  let eventEmitter: any;

  const mockTenant: Partial<TenantConfigEntity> = {
    id: '11111111-1111-1111-1111-111111111111',
    tenantCode: 'DEFAULT',
    name: 'Sumtech Telecom',
    companyName: 'SUMTECH TELECOM S.R.L.',
    commercialName: 'SUMTECH FIBRA & TV',
    rnc: '131000000',
    address: 'Av. 27 de Febrero esq. Winston Churchill, Santo Domingo, D.N.',
    phone: '809-555-0199',
    email: 'facturacion@sumtech.com.do',
    supportEmail: 'soporte@sumtech.com.do',
    website: 'https://sumtech.com.do',
    currency: 'DOP',
    timezone: 'America/Santo_Domingo',
    isActive: true,
    isDefault: true,
    municipality: { code: '010100' } as any,
    province: { code: '010000' } as any,
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    tenantRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((dto) => ({ ...dto, id: 'new-uuid' })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ ...entity, id: entity.id || 'new-uuid' })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    dataSource = {
      transaction: jest.fn().mockImplementation(async (cb) => {
        return cb({
          getRepository: () => tenantRepo,
        });
      }),
    };

    eventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyService,
        { provide: getRepositoryToken(TenantConfigEntity), useValue: tenantRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<CompanyService>(CompanyService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('getDefaultTenant', () => {
    it('debe retornar el tenant marcado como isDefault = true', async () => {
      tenantRepo.findOne.mockResolvedValueOnce(mockTenant);

      const result = await service.getDefaultTenant();

      expect(result).toEqual(mockTenant);
      expect(tenantRepo.findOne).toHaveBeenCalledWith({
        where: { isDefault: true },
        relations: ['country', 'province', 'municipality', 'sector'],
      });
    });

    it('si no hay isDefault, debe buscar el primer tenant activo', async () => {
      tenantRepo.findOne
        .mockResolvedValueOnce(null) // no default
        .mockResolvedValueOnce(mockTenant); // first active

      const result = await service.getDefaultTenant();

      expect(result).toEqual(mockTenant);
    });

    it('si no existe ningún tenant en la BD, debe inicializar el tenant por defecto de Sumtech', async () => {
      tenantRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getDefaultTenant();

      expect(tenantRepo.create).toHaveBeenCalled();
      expect(tenantRepo.save).toHaveBeenCalled();
      expect(result.tenantCode).toBe('DEFAULT');
      expect(result.companyName).toBe('SUMTECH TELECOM S.R.L.');
    });
  });

  describe('findById', () => {
    it('debe retornar el tenant cuando existe', async () => {
      tenantRepo.findOne.mockResolvedValue(mockTenant);

      const result = await service.findById('11111111-1111-1111-1111-111111111111');
      expect(result).toEqual(mockTenant);
    });

    it('debe lanzar NotFoundException cuando no existe el ID', async () => {
      tenantRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('non-existing-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByCode', () => {
    it('debe retornar el tenant cuando existe el código', async () => {
      tenantRepo.findOne.mockResolvedValue(mockTenant);

      const result = await service.findByCode('DEFAULT');
      expect(result).toEqual(mockTenant);
    });

    it('debe lanzar NotFoundException cuando no existe el código', async () => {
      tenantRepo.findOne.mockResolvedValue(null);

      await expect(service.findByCode('INEXISTENTE')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('debe lanzar ConflictException si el tenantCode ya existe', async () => {
      tenantRepo.findOne.mockResolvedValue(mockTenant);

      await expect(
        service.create({
          tenantCode: 'DEFAULT',
          name: 'Duplicado',
          companyName: 'Empresa',
          rnc: '131000000',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('debe crear un nuevo tenant exitosamente y emitir evento', async () => {
      tenantRepo.findOne
        .mockResolvedValueOnce(null) // no duplicate
        .mockResolvedValueOnce({ ...mockTenant, tenantCode: 'NEW-TENANT' }); // findById after save

      const result = await service.create({
        tenantCode: 'NEW-TENANT',
        name: 'Nueva Sucursal',
        companyName: 'Nueva SRL',
        rnc: '132000000',
        isDefault: true,
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'company.tenant.created',
        expect.objectContaining({ tenantCode: 'NEW-TENANT' }),
      );
      expect(result.tenantCode).toBe('NEW-TENANT');
    });
  });

  describe('update', () => {
    it('debe actualizar los campos del tenant y emitir evento', async () => {
      const updatedMock = { ...mockTenant, companyName: 'SUMTECH DOMINICANA SRL' };
      tenantRepo.findOne
        .mockResolvedValueOnce({ ...mockTenant }) // findById in update
        .mockResolvedValueOnce(updatedMock); // findById after save

      const result = await service.update(mockTenant.id!, {
        companyName: 'SUMTECH DOMINICANA SRL',
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'company.tenant.updated',
        expect.objectContaining({ tenantId: mockTenant.id }),
      );
      expect(result.companyName).toBe('SUMTECH DOMINICANA SRL');
    });

    it('debe lanzar ConflictException si intenta cambiar a un tenantCode que pertenece a otro tenant', async () => {
      tenantRepo.findOne
        .mockResolvedValueOnce({ ...mockTenant, id: 'id-1', tenantCode: 'TENANT-1' })
        .mockResolvedValueOnce({ ...mockTenant, id: 'id-2', tenantCode: 'TENANT-2' }); // duplicate check

      await expect(
        service.update('id-1', { tenantCode: 'TENANT-2' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('setDefault', () => {
    it('debe marcar el tenant objetivo como isDefault = true y los demás en false', async () => {
      tenantRepo.findOne.mockResolvedValue({ ...mockTenant, id: 'target-id', isDefault: true });

      const result = await service.setDefault('target-id');

      expect(tenantRepo.update).toHaveBeenCalledWith({ isDefault: true }, { isDefault: false });
      expect(tenantRepo.update).toHaveBeenCalledWith({ id: 'target-id' }, { isDefault: true });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'company.tenant.default_changed',
        expect.objectContaining({ tenantId: 'target-id' }),
      );
      expect(result.isDefault).toBe(true);
    });
  });

  describe('getCompanyFiscalInfo', () => {
    it('debe retornar la proyección adecuada para facturas y DGII', async () => {
      tenantRepo.findOne.mockResolvedValue(mockTenant);

      const fiscal = await service.getCompanyFiscalInfo();

      expect(fiscal).toEqual({
        rnc: '131000000',
        razonSocial: 'SUMTECH TELECOM S.R.L.',
        nombreComercial: 'SUMTECH FIBRA & TV',
        direccion: 'Av. 27 de Febrero esq. Winston Churchill, Santo Domingo, D.N.',
        municipio: '010100',
        provincia: '010000',
        correo: 'facturacion@sumtech.com.do',
        telefono: '809-555-0199',
        website: 'https://sumtech.com.do',
      });
    });
  });
});
