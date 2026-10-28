import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RouterOsClientResolverService } from './routeros-client-resolver.service';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import { ROUTEROS_CLIENT_FACTORY, ROUTEROS_BINARY_CLIENT_FACTORY } from '../routeros/routeros-client-factory';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { encryptCredential } from '../../network-connectivity/utils/crypto.util';

describe('RouterOsClientResolverService', () => {
  let service: RouterOsClientResolverService;
  let restClientFactory: jest.Mock;
  let binaryClientFactory: jest.Mock;
  let reachabilityResolver: any;

  const baseNode = {
    id: 'node-1',
    name: 'RB Las Yayas',
    managementIp: '10.10.0.1',
    apiPort: 8729,
    useHttps: false,
    apiUser: 'erp-admin',
    transportType: 'REST',
  } as NetworkNodeEntity;

  beforeEach(async () => {
    restClientFactory = jest.fn().mockReturnValue({ rest: true });
    binaryClientFactory = jest.fn().mockReturnValue({ binary: true });
    reachabilityResolver = {
      resolveEndpoint: jest.fn().mockResolvedValue({ host: '10.254.1.12', port: 8088, useHttps: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouterOsClientResolverService,
        { provide: ROUTEROS_CLIENT_FACTORY, useValue: restClientFactory },
        { provide: ROUTEROS_BINARY_CLIENT_FACTORY, useValue: binaryClientFactory },
        { provide: ReachabilityResolver, useValue: reachabilityResolver },
      ],
    }).compile();

    service = module.get(RouterOsClientResolverService);
    process.env.ROUTEROS_CREDENTIALS = JSON.stringify({ 'RB Las Yayas': { username: 'fallback-user', password: 'fallback-pass' } });
  });

  afterEach(() => {
    delete process.env.ROUTEROS_CREDENTIALS;
  });

  it('está definido', () => {
    expect(service).toBeDefined();
  });

  describe('selección de implementación por transportType', () => {
    it('usa el factory REST cuando transportType es REST', async () => {
      const node = { ...baseNode, apiPasswordEnc: encryptCredential('secret') };
      const client = await service.resolveClient(node);
      expect(restClientFactory).toHaveBeenCalledWith({
        managementIp: '10.254.1.12',
        apiPort: 8088,
        useHttps: false,
        username: 'erp-admin',
        password: 'secret',
      });
      expect(binaryClientFactory).not.toHaveBeenCalled();
      expect(client).toEqual({ rest: true });
    });

    it('usa el factory binario cuando transportType es ROUTEROS_API', async () => {
      const node = { ...baseNode, transportType: 'ROUTEROS_API' as const, apiPasswordEnc: encryptCredential('secret') };
      const client = await service.resolveClient(node);
      expect(binaryClientFactory).toHaveBeenCalledWith({
        managementIp: '10.254.1.12',
        apiPort: 8088,
        useHttps: false,
        username: 'erp-admin',
        password: 'secret',
      });
      expect(restClientFactory).not.toHaveBeenCalled();
      expect(client).toEqual({ binary: true });
    });

    it('rechaza transportType SSH con un mensaje explícito, sin siquiera resolver el endpoint', async () => {
      const node = { ...baseNode, transportType: 'SSH' as const };
      await expect(service.resolveClient(node)).rejects.toThrow(BadRequestException);
      await expect(service.resolveClient(node)).rejects.toThrow(/no soporta gestión estructurada/i);
      expect(reachabilityResolver.resolveEndpoint).not.toHaveBeenCalled();
      expect(restClientFactory).not.toHaveBeenCalled();
      expect(binaryClientFactory).not.toHaveBeenCalled();
    });
  });

  describe('resolución de credenciales', () => {
    it('descifra apiPasswordEnc y usa apiUser cuando el nodo tiene contraseña propia', async () => {
      const node = { ...baseNode, apiUser: 'erp-admin', apiPasswordEnc: encryptCredential('mi-secreto') };
      await service.resolveClient(node);
      expect(restClientFactory).toHaveBeenCalledWith(expect.objectContaining({ username: 'erp-admin', password: 'mi-secreto' }));
    });

    it('cae a ROUTEROS_CREDENTIALS por nombre de nodo cuando no hay apiPasswordEnc', async () => {
      const node = { ...baseNode, apiPasswordEnc: undefined };
      await service.resolveClient(node);
      expect(restClientFactory).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'fallback-user', password: 'fallback-pass' }),
      );
    });

    it('usa "admin" como username por defecto si no hay apiUser ni apiPasswordEnc y falla ROUTEROS_CREDENTIALS', async () => {
      delete process.env.ROUTEROS_CREDENTIALS;
      const node = { ...baseNode, apiUser: undefined, apiPasswordEnc: undefined, name: 'Nodo-Sin-Credenciales' };
      await expect(service.resolveClient(node)).rejects.toThrow(/ROUTEROS_CREDENTIALS/);
    });
  });

  describe('resolución de endpoint', () => {
    it('usa host/port/useHttps resueltos por ReachabilityResolver cuando tiene éxito', async () => {
      reachabilityResolver.resolveEndpoint.mockResolvedValue({ host: '10.254.1.12', port: 8088, useHttps: true });
      const node = { ...baseNode, apiPasswordEnc: encryptCredential('secret') };
      await service.resolveClient(node);
      expect(restClientFactory).toHaveBeenCalledWith(
        expect.objectContaining({ managementIp: '10.254.1.12', apiPort: 8088, useHttps: true }),
      );
    });

    it('cae a managementIp/apiPort/useHttps del nodo si ReachabilityResolver falla', async () => {
      reachabilityResolver.resolveEndpoint.mockRejectedValue(new Error('sin túnel'));
      const node = { ...baseNode, apiPasswordEnc: encryptCredential('secret') };
      await service.resolveClient(node);
      expect(restClientFactory).toHaveBeenCalledWith(
        expect.objectContaining({ managementIp: '10.10.0.1', apiPort: 8729, useHttps: false }),
      );
    });

    it('lanza un error claro si no hay ningún host alcanzable', async () => {
      reachabilityResolver.resolveEndpoint.mockRejectedValue(new Error('sin túnel'));
      const node = { ...baseNode, managementIp: undefined, apiPasswordEnc: encryptCredential('secret') };
      await expect(service.resolveClient(node)).rejects.toThrow(/no tiene ip de gestión/i);
      expect(restClientFactory).not.toHaveBeenCalled();
    });
  });
});
