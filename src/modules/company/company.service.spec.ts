import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TENANT_DATA_SOURCE } from '../../common/tenancy/tenant-datasource.provider';
import { CompanyService } from './company.service';
import { CompanyProfileEntity } from './entities/company-profile.entity';
import { MinioStorageService } from '../storage/minio-storage.service';

describe('CompanyService', () => {
  let service: CompanyService;
  let profileRepo: any;
  let dataSource: any;
  let eventEmitter: any;
  let minioStorage: any;

  const mockProfile: Partial<CompanyProfileEntity> = {
    id: '11111111-1111-1111-1111-111111111111',
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
    municipality: { code: '010100' } as any,
    province: { code: '010000' } as any,
    siteContent: {},
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    profileRepo = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((dto) => ({ ...dto, id: 'new-uuid' })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ ...entity, id: entity.id || 'new-uuid' })),
    };

    dataSource = {
      transaction: jest.fn().mockImplementation(async (cb) => {
        return cb({ getRepository: () => profileRepo });
      }),
    };

    eventEmitter = { emit: jest.fn() };

    minioStorage = {
      uploadBuffer: jest.fn().mockResolvedValue('dgii-certs/uuid_cert.p12'),
      getObjectBuffer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyService,
        { provide: getRepositoryToken(CompanyProfileEntity), useValue: profileRepo },
        { provide: TENANT_DATA_SOURCE, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: MinioStorageService, useValue: minioStorage },
      ],
    }).compile();

    service = module.get<CompanyService>(CompanyService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('getProfile', () => {
    it('debe retornar el perfil existente de este tenant', async () => {
      profileRepo.findOne.mockResolvedValueOnce(mockProfile);

      const result = await service.getProfile();

      expect(result).toEqual(mockProfile);
      expect(profileRepo.findOne).toHaveBeenCalledWith({
        where: {},
        relations: ['country', 'province', 'municipality', 'sector'],
        order: { createdAt: 'ASC' },
      });
    });

    it('si no existe ningún perfil en la BD de este tenant, debe sembrar uno mínimo', async () => {
      profileRepo.findOne.mockResolvedValueOnce(null);

      const result = await service.getProfile();

      expect(profileRepo.create).toHaveBeenCalled();
      expect(profileRepo.save).toHaveBeenCalled();
      expect(result.name).toBe('Mi Empresa');
    });
  });

  describe('findById', () => {
    it('debe retornar el perfil cuando existe', async () => {
      profileRepo.findOne.mockResolvedValue(mockProfile);

      const result = await service.findById('11111111-1111-1111-1111-111111111111');
      expect(result).toEqual(mockProfile);
    });

    it('si el id no existe, cae de vuelta al get-or-create en vez de lanzar 404', async () => {
      profileRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      const result = await service.findById('non-existing-id');
      expect(result.name).toBe('Mi Empresa');
    });
  });

  describe('update', () => {
    it('debe actualizar los campos del perfil y emitir evento', async () => {
      profileRepo.findOne.mockResolvedValueOnce({ ...mockProfile });

      const result = await service.update({ companyName: 'SUMTECH DOMINICANA SRL' });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'company.profile.updated',
        expect.objectContaining({ profileId: mockProfile.id }),
      );
      expect(result.companyName).toBe('SUMTECH DOMINICANA SRL');
    });
  });

  describe('uploadDgiiCertificate', () => {
    it('debe subir el certificado a MinIO y guardarlo en el perfil', async () => {
      profileRepo.findOne.mockResolvedValueOnce({ ...mockProfile });

      const result = await service.uploadDgiiCertificate(Buffer.from('cert-bytes'), 'cert.p12');

      expect(minioStorage.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        'cert.p12',
        'dgii-certs',
        'application/x-pkcs12',
      );
      expect(result.dgiiCertObjectKey).toBe('dgii-certs/uuid_cert.p12');
    });
  });

  describe('getDgiiSettings', () => {
    it('debe retornar la configuración DGII persistida en el perfil', async () => {
      profileRepo.findOne.mockResolvedValueOnce({
        ...mockProfile,
        dgiiEnvironment: 'testecf',
        dgiiAuthUrl: 'https://ecf.dgii.gov.do/testecf/',
        dgiiCertObjectKey: 'dgii-certs/x.p12',
        dgiiCertPassword: 'secret',
      });

      const result = await service.getDgiiSettings();

      expect(result).toEqual({
        environment: 'testecf',
        authUrl: 'https://ecf.dgii.gov.do/testecf/',
        certObjectKey: 'dgii-certs/x.p12',
        certPassword: 'secret',
      });
    });
  });

  describe('uploadCompanyLogo', () => {
    it('debe subir el logo a MinIO y actualizar settings y logoUrl', async () => {
      profileRepo.findOne.mockResolvedValueOnce({ ...mockProfile, settings: {} });
      minioStorage.uploadBuffer.mockResolvedValueOnce('company-logos/uuid_logo.png');

      const result = await service.uploadCompanyLogo(
        Buffer.from('fake-logo'),
        'logo.png',
        'image/png',
      );

      expect(minioStorage.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        'logo.png',
        'company-logos',
        'image/png',
      );
      expect(result.logoUrl).toBe('/api/v1/company/logo');
      expect(result.settings.logoObjectKey).toBe('company-logos/uuid_logo.png');
      expect(result.settings.logoMimeType).toBe('image/png');
      expect(eventEmitter.emit).toHaveBeenCalledWith('company.profile.updated', expect.any(Object));
    });
  });

  describe('deleteCompanyLogo', () => {
    it('debe limpiar logoUrl y settings del logo', async () => {
      profileRepo.findOne.mockResolvedValueOnce({
        ...mockProfile,
        logoUrl: '/api/v1/company/logo',
        settings: { logoObjectKey: 'company-logos/old.png', logoMimeType: 'image/png' },
      });

      const result = await service.deleteCompanyLogo();

      expect(result.logoUrl).toBeNull();
      expect(result.settings.logoObjectKey).toBeUndefined();
      expect(result.settings.logoMimeType).toBeUndefined();
      expect(eventEmitter.emit).toHaveBeenCalledWith('company.profile.updated', expect.any(Object));
    });
  });

  describe('getCompanyLogo', () => {
    it('debe retornar null si no hay logo configurado', async () => {
      profileRepo.findOne.mockResolvedValueOnce({ ...mockProfile, settings: {} });

      const result = await service.getCompanyLogo();
      expect(result).toBeNull();
    });

    it('debe retornar buffer y mimeType cuando existe logo en MinIO', async () => {
      profileRepo.findOne.mockResolvedValueOnce({
        ...mockProfile,
        settings: { logoObjectKey: 'company-logos/uuid.png', logoMimeType: 'image/png' },
      });
      minioStorage.getObjectBuffer.mockResolvedValueOnce(Buffer.from('minio-bytes'));

      const result = await service.getCompanyLogo();
      expect(result).toEqual({ buffer: Buffer.from('minio-bytes'), mimeType: 'image/png' });
    });
  });

  describe('getCompanyFiscalInfo', () => {
    it('debe retornar la proyección adecuada para facturas y DGII', async () => {
      profileRepo.findOne.mockResolvedValue(mockProfile);

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

