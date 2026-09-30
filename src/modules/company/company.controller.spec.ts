import { Test, TestingModule } from '@nestjs/testing';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';

describe('CompanyController', () => {
  let controller: CompanyController;
  let service: any;

  const mockProfile = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Sumtech Telecom',
    companyName: 'SUMTECH TELECOM S.R.L.',
    rnc: '131000000',
  };

  beforeEach(async () => {
    service = {
      getProfile: jest.fn().mockResolvedValue(mockProfile),
      update: jest.fn().mockResolvedValue({ ...mockProfile, companyName: 'UPDATED' }),
      uploadDgiiCertificate: jest.fn().mockResolvedValue({ ...mockProfile, dgiiCertObjectKey: 'dgii-certs/x.p12' }),
      uploadCompanyLogo: jest.fn().mockResolvedValue({ ...mockProfile, logoUrl: '/api/v1/company/logo' }),
      deleteCompanyLogo: jest.fn().mockResolvedValue({ ...mockProfile, logoUrl: null }),
      getCompanyLogo: jest.fn().mockResolvedValue({ buffer: Buffer.from('png-bytes'), mimeType: 'image/png' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CompanyController],
      providers: [
        { provide: CompanyService, useValue: service },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('dev-secret') } },
        {
          provide: TenantContextService,
          useValue: {
            hasContext: jest.fn().mockReturnValue(true),
            getTenantId: jest.fn(),
            getSlug: jest.fn(),
            getPlanFeatures: jest.fn().mockReturnValue({}),
          },
        },
      ],
    }).compile();

    controller = module.get<CompanyController>(CompanyController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('getConfig debe retornar el perfil de este tenant, enmascarando dgiiCertPassword y agregando features', async () => {
    const res = await controller.getConfig();
    expect(res).toEqual({ ...mockProfile, hasDgiiCertPassword: false, features: {} });
    expect(service.getProfile).toHaveBeenCalled();
  });

  it('getConfig debe reportar hasDgiiCertPassword=true sin filtrar el valor real', async () => {
    service.getProfile.mockResolvedValueOnce({ ...mockProfile, dgiiCertPassword: 'enc:v1:abc:def:ghi' });
    const res: any = await controller.getConfig();
    expect(res.hasDgiiCertPassword).toBe(true);
    expect(res.dgiiCertPassword).toBeUndefined();
  });

  it('updateConfig debe actualizar el perfil de este tenant', async () => {
    const res = await controller.updateConfig({ companyName: 'UPDATED' });
    expect(res.companyName).toBe('UPDATED');
    expect(service.update).toHaveBeenCalledWith({ companyName: 'UPDATED' });
  });

  it('uploadDgiiCert debe delegar a service.uploadDgiiCertificate', async () => {
    const file = { buffer: Buffer.from('cert-bytes'), originalname: 'cert.p12' } as Express.Multer.File;
    const res = await controller.uploadDgiiCert(file);
    expect(res.dgiiCertObjectKey).toBe('dgii-certs/x.p12');
    expect(service.uploadDgiiCertificate).toHaveBeenCalledWith(file.buffer, 'cert.p12');
  });

  it('uploadDgiiCert debe rechazar cuando no se adjunta archivo', async () => {
    await expect(controller.uploadDgiiCert(undefined as any)).rejects.toThrow();
  });

  describe('uploadLogo', () => {
    it('debe subir una imagen válida delegando a service.uploadCompanyLogo', async () => {
      const file = {
        buffer: Buffer.from('fake-png'),
        originalname: 'logo.png',
        mimetype: 'image/png',
        size: 1024,
      } as Express.Multer.File;

      const res = await controller.uploadLogo(file);
      expect(res.logoUrl).toBe('/api/v1/company/logo');
      expect(service.uploadCompanyLogo).toHaveBeenCalledWith(file.buffer, 'logo.png', 'image/png');
    });

    it('debe rechazar cuando no se adjunta ningún archivo', async () => {
      await expect(controller.uploadLogo(undefined as any)).rejects.toThrow(
        'Debes adjuntar un archivo de imagen para el logotipo.',
      );
    });

    it('debe rechazar cuando el formato no es permitido (ej. application/pdf)', async () => {
      const file = {
        buffer: Buffer.from('fake-pdf'),
        originalname: 'document.pdf',
        mimetype: 'application/pdf',
        size: 1024,
      } as Express.Multer.File;

      await expect(controller.uploadLogo(file)).rejects.toThrow(
        'Formato "application/pdf" no soportado. Se admiten PNG, JPG, WebP o SVG.',
      );
    });

    it('debe rechazar cuando el archivo excede 3 MB', async () => {
      const file = {
        buffer: Buffer.from('large'),
        originalname: 'big.png',
        mimetype: 'image/png',
        size: 4 * 1024 * 1024,
      } as Express.Multer.File;

      await expect(controller.uploadLogo(file)).rejects.toThrow(
        'El logotipo no debe superar los 3 MB.',
      );
    });
  });

  describe('deleteLogo', () => {
    it('debe delegar en service.deleteCompanyLogo y retornar perfil actualizado', async () => {
      const res = await controller.deleteLogo();
      expect(res.logoUrl).toBeNull();
      expect(service.deleteCompanyLogo).toHaveBeenCalled();
    });
  });

  describe('getLogo', () => {
    it('debe transmitir los bytes del logo con cabeceras de content-type y cache', async () => {
      const resMock = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as any;

      await controller.getLogo(resMock);

      expect(resMock.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(resMock.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=86400, stale-while-revalidate=604800',
      );
      expect(resMock.send).toHaveBeenCalledWith(Buffer.from('png-bytes'));
    });

    it('debe lanzar NotFoundException si el tenant no tiene logo', async () => {
      service.getCompanyLogo.mockResolvedValueOnce(null);
      const resMock = { setHeader: jest.fn(), send: jest.fn() } as any;

      await expect(controller.getLogo(resMock)).rejects.toThrow(
        'Esta empresa no tiene un logotipo personalizado configurado.',
      );
    });
  });
});

