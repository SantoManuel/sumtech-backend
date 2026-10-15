import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { PortalRedirectService } from './portal-redirect.service';
import { NodePortalRegistryEntity } from './entities/node-portal-registry.entity';
import { TenantEntity } from './entities/tenant.entity';

describe('PortalRedirectService', () => {
  let service: PortalRedirectService;
  let registryRepo: any;
  let tenantRepo: any;
  let configService: any;

  beforeEach(async () => {
    registryRepo = { findOneBy: jest.fn() };
    tenantRepo = { findOneBy: jest.fn() };
    configService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortalRedirectService,
        { provide: getRepositoryToken(NodePortalRegistryEntity, 'platform'), useValue: registryRepo },
        { provide: getRepositoryToken(TenantEntity, 'platform'), useValue: tenantRepo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(PortalRedirectService);
  });

  it('devuelve null si no hay IP de origen', async () => {
    const result = await service.resolveRedirectUrl(undefined);
    expect(result).toBeNull();
    expect(registryRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('devuelve null si ninguna IP pública registrada matchea', async () => {
    registryRepo.findOneBy.mockResolvedValue(null);

    const result = await service.resolveRedirectUrl('200.1.2.3');

    expect(result).toBeNull();
    expect(registryRepo.findOneBy).toHaveBeenCalledWith({ publicIp: '200.1.2.3' });
  });

  it('devuelve null si el registro apunta a un tenant que ya no existe', async () => {
    registryRepo.findOneBy.mockResolvedValue({ tenantId: 'tenant-x', publicIp: '200.1.2.3' });
    tenantRepo.findOneBy.mockResolvedValue(null);

    const result = await service.resolveRedirectUrl('200.1.2.3');

    expect(result).toBeNull();
  });

  it('construye la URL https://{slug}.{SAAS_ROOT_DOMAIN}/aviso cuando matchea', async () => {
    registryRepo.findOneBy.mockResolvedValue({ tenantId: 'tenant-1', publicIp: '200.1.2.3' });
    tenantRepo.findOneBy.mockResolvedValue({ id: 'tenant-1', slug: 'sumtech' });
    configService.get.mockReturnValue('sumtech.com.do');

    const result = await service.resolveRedirectUrl('200.1.2.3');

    expect(result).toBe('https://sumtech.sumtech.com.do/aviso');
  });

  it('usa http y localhost como fallback si SAAS_ROOT_DOMAIN no está configurado', async () => {
    registryRepo.findOneBy.mockResolvedValue({ tenantId: 'tenant-1', publicIp: '200.1.2.3' });
    tenantRepo.findOneBy.mockResolvedValue({ id: 'tenant-1', slug: 'sumtech' });
    configService.get.mockReturnValue(undefined);

    const result = await service.resolveRedirectUrl('200.1.2.3');

    expect(result).toBe('http://sumtech.localhost:3000/aviso');
  });
});
