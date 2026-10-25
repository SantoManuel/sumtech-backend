import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { GenieAcsVendorParametersController } from './genieacs-vendor-parameters.controller';
import { GenieAcsVendorParameterService } from '../services/genieacs-vendor-parameter.service';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';

describe('GenieAcsVendorParametersController', () => {
  let controller: GenieAcsVendorParametersController;
  let mockService: any;

  beforeEach(async () => {
    mockService = {
      listCatalog: jest.fn().mockResolvedValue([{ id: 'p1', vendor: 'ZTE' }]),
      createCatalogEntry: jest.fn().mockResolvedValue({ id: 'p2' }),
      deleteCatalogEntry: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GenieAcsVendorParametersController],
      providers: [
        { provide: GenieAcsVendorParameterService, useValue: mockService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: TenantContextService,
          useValue: {
            hasContext: jest.fn().mockReturnValue(true),
            getTenantId: jest.fn(),
            getSlug: jest.fn().mockReturnValue('sumtech'),
          },
        },
      ],
    }).compile();

    controller = module.get<GenieAcsVendorParametersController>(GenieAcsVendorParametersController);
  });

  it('list delega el filtro de vendor al servicio', async () => {
    const result = await controller.list('ZTE');

    expect(mockService.listCatalog).toHaveBeenCalledWith('ZTE');
    expect(result).toEqual([{ id: 'p1', vendor: 'ZTE' }]);
  });

  it('create pasa el actor como createdBy', async () => {
    const dto = { vendor: 'ZTE', category: 'SECURITY', parameterKey: 'wanFtpEnable', label: 'FTP', oidPath: 'x' } as any;

    const result = await controller.create(dto, 'user-1');

    expect(mockService.createCatalogEntry).toHaveBeenCalledWith(dto, 'user-1');
    expect(result).toEqual({ id: 'p2' });
  });

  it('remove delega al servicio', async () => {
    const result = await controller.remove('p1');

    expect(mockService.deleteCatalogEntry).toHaveBeenCalledWith('p1');
    expect(result).toEqual({ success: true });
  });
});
