import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RouterOsProvisioningAdapter } from './routeros-provisioning.adapter';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { ROUTEROS_CLIENT_FACTORY } from './routeros/routeros-client-factory';
import { ReachabilityResolver } from '../network-connectivity/services/reachability-resolver.service';

describe('RouterOsProvisioningAdapter', () => {
  let adapter: RouterOsProvisioningAdapter;
  let nodeRepo: any;
  let accessRepo: any;
  let clientFactory: jest.Mock;
  let reachabilityResolver: any;

  const makeNode = (overrides: Partial<NetworkNodeEntity> = {}): NetworkNodeEntity =>
    ({ id: 'node-1', name: 'RB Las Yayas', managementIp: '10.10.0.1', apiPort: 8729, ...overrides }) as NetworkNodeEntity;

  const makeAccess = (overrides: Partial<NetworkAccessEntity> = {}): NetworkAccessEntity =>
    ({ id: 'access-1', contractId: 'contract-1', nodeId: 'node-1', username: 't1@tecmas', ...overrides }) as NetworkAccessEntity;

  beforeEach(async () => {
    nodeRepo = { findOneBy: jest.fn() };
    accessRepo = { update: jest.fn().mockResolvedValue(undefined) };
    clientFactory = jest.fn();
    reachabilityResolver = {
      resolveEndpoint: jest.fn().mockResolvedValue({ host: '10.10.0.1', port: 8729, useHttps: false, method: 'API' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouterOsProvisioningAdapter,
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: getRepositoryToken(NetworkAccessEntity), useValue: accessRepo },
        { provide: ROUTEROS_CLIENT_FACTORY, useValue: clientFactory },
        { provide: ReachabilityResolver, useValue: reachabilityResolver },
      ],
    }).compile();

    adapter = module.get<RouterOsProvisioningAdapter>(RouterOsProvisioningAdapter);
    process.env.ROUTEROS_CREDENTIALS = JSON.stringify({ 'RB Las Yayas': { username: 'api', password: 'secret' } });
  });

  afterEach(() => {
    delete process.env.ROUTEROS_CREDENTIALS;
  });

  it('debe estar definido', () => {
    expect(adapter).toBeDefined();
  });

  it('suspend hace PATCH disabled=true sobre el secreto existente y tumba sesión activa', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    const setPppSecretDisabled = jest.fn().mockResolvedValue(undefined);
    const killActiveSession = jest.fn().mockResolvedValue(true);
    const findActiveSessionByName = jest.fn().mockResolvedValue({ id: '*10', name: 't1@tecmas' });
    clientFactory.mockReturnValue({
      findPppSecretByName: jest.fn().mockResolvedValue({ id: '*1', name: 't1@tecmas', disabled: false }),
      setPppSecretDisabled,
      findActiveSessionByName,
      killActiveSession,
    });

    const result = await adapter.suspend(makeAccess());

    expect(result).toEqual({ ok: true });
    expect(setPppSecretDisabled).toHaveBeenCalledWith('*1', true);
    expect(killActiveSession).toHaveBeenCalledWith('t1@tecmas');
  });

  it('restore hace PATCH disabled=false sobre el secreto existente', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    const setPppSecretDisabled = jest.fn().mockResolvedValue(undefined);
    clientFactory.mockReturnValue({
      findPppSecretByName: jest.fn().mockResolvedValue({ id: '*1', name: 't1@tecmas', disabled: true }),
      setPppSecretDisabled,
      findActiveSessionByName: jest.fn().mockResolvedValue(null),
    });

    const result = await adapter.restore(makeAccess());

    expect(result).toEqual({ ok: true });
    expect(setPppSecretDisabled).toHaveBeenCalledWith('*1', false);
  });

  it('deprovision deshabilita el secreto (nunca lo borra) y tumba la sesión', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    const setPppSecretDisabled = jest.fn().mockResolvedValue(undefined);
    const killActiveSession = jest.fn().mockResolvedValue(true);
    clientFactory.mockReturnValue({
      findPppSecretByName: jest.fn().mockResolvedValue({ id: '*1', name: 't1@tecmas', disabled: false }),
      setPppSecretDisabled,
      findActiveSessionByName: jest.fn().mockResolvedValue({ id: '*10', name: 't1@tecmas' }),
      killActiveSession,
    });

    const result = await adapter.deprovision(makeAccess());

    expect(result).toEqual({ ok: true });
    expect(setPppSecretDisabled).toHaveBeenCalledWith('*1', true);
    expect(killActiveSession).toHaveBeenCalledWith('t1@tecmas');
  });

  it('es idempotente: si el secreto ya está en el estado deseado, no hace PATCH', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    const setPppSecretDisabled = jest.fn();
    clientFactory.mockReturnValue({
      findPppSecretByName: jest.fn().mockResolvedValue({ id: '*1', name: 't1@tecmas', disabled: true }),
      setPppSecretDisabled,
      findActiveSessionByName: jest.fn().mockResolvedValue(null),
    });

    const result = await adapter.suspend(makeAccess());

    expect(result).toEqual({ ok: true });
    expect(setPppSecretDisabled).not.toHaveBeenCalled();
  });

  it('provision crea el secreto en el router de forma automatizada (RF-PPP-004)', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    const ensurePppSecret = jest.fn().mockResolvedValue({ id: '*5', name: 't1@tecmas' });
    clientFactory.mockReturnValue({
      ensurePppSecret,
      findActiveSessionByName: jest.fn().mockResolvedValue(null),
    });

    const result = await adapter.provision(makeAccess({ ipAddress: '10.20.0.50' }));

    expect(result.ok).toBe(true);
    expect(ensurePppSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 't1@tecmas',
        remoteAddress: '10.20.0.50',
      }),
    );
  });

  it('falla sin llamar al nodo si el acceso no tiene usuario configurado', async () => {
    const result = await adapter.suspend(makeAccess({ username: undefined }));

    expect(result.ok).toBe(false);
    expect(nodeRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('falla sin llamar al nodo si el acceso no tiene nodo asignado', async () => {
    const result = await adapter.suspend(makeAccess({ nodeId: undefined }));

    expect(result.ok).toBe(false);
    expect(nodeRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('falla si el nodo asignado ya no existe', async () => {
    nodeRepo.findOneBy.mockResolvedValue(null);

    const result = await adapter.suspend(makeAccess());

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ya no existe');
  });

  it('falla si el nodo no tiene IP de gestión configurada', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode({ managementIp: undefined }));
    reachabilityResolver.resolveEndpoint.mockRejectedValue(new Error('Sin IP de gestión'));

    const result = await adapter.suspend(makeAccess());

    expect(result.ok).toBe(false);
    expect(result.error).toContain('IP de gestión');
  });

  it('falla con el motivo de credenciales si el nodo no tiene ROUTEROS_CREDENTIALS configurado', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    delete process.env.ROUTEROS_CREDENTIALS;

    const result = await adapter.suspend(makeAccess());

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ROUTEROS_CREDENTIALS/);
  });

  it('falla con el motivo real si el PATCH contra el nodo lanza un error', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    clientFactory.mockReturnValue({
      findPppSecretByName: jest.fn().mockResolvedValue({ id: '*1', name: 't1@tecmas', disabled: false }),
      setPppSecretDisabled: jest.fn().mockRejectedValue(new Error('403 no autorizado')),
    });

    const result = await adapter.suspend(makeAccess());

    expect(result.ok).toBe(false);
    expect(result.error).toContain('403 no autorizado');
  });

  describe('syncProfile', () => {
    it('garantiza el perfil en el nodo (ensureProfile) y reasigna el secreto cuando tenía otro perfil', async () => {
      nodeRepo.findOneBy.mockResolvedValue(makeNode());
      const ensureProfile = jest.fn().mockResolvedValue({ id: '*7', name: 'Sumtech-50Mbps', rateLimit: '50M/50M' });
      const setPppSecretProfile = jest.fn().mockResolvedValue(undefined);
      clientFactory.mockReturnValue({
        findPppSecretByName: jest.fn().mockResolvedValue({ id: '*1', name: 't1@tecmas', disabled: false, profile: 'default' }),
        ensureProfile,
        setPppSecretProfile,
        findActiveSessionByName: jest.fn().mockResolvedValue(null),
      });

      const result = await adapter.syncProfile(makeAccess(), { name: 'Sumtech-50Mbps', rateLimitMbps: 50 });

      expect(result).toEqual({ ok: true });
      expect(ensureProfile).toHaveBeenCalledWith(
        'Sumtech-50Mbps',
        '50M/50M',
        expect.objectContaining({ onlyOne: true }),
      );
      expect(setPppSecretProfile).toHaveBeenCalledWith('*1', 'Sumtech-50Mbps');
    });

    it('es idempotente: si el secreto ya tiene ese perfil asignado, no hace PATCH sobre el secreto (pero sí garantiza el perfil)', async () => {
      nodeRepo.findOneBy.mockResolvedValue(makeNode());
      const ensureProfile = jest.fn().mockResolvedValue({ id: '*7', name: 'Sumtech-50Mbps', rateLimit: '50M/50M' });
      const setPppSecretProfile = jest.fn();
      clientFactory.mockReturnValue({
        findPppSecretByName: jest.fn().mockResolvedValue({ id: '*1', name: 't1@tecmas', disabled: false, profile: 'Sumtech-50Mbps' }),
        ensureProfile,
        setPppSecretProfile,
        findActiveSessionByName: jest.fn().mockResolvedValue(null),
      });

      const result = await adapter.syncProfile(makeAccess(), { name: 'Sumtech-50Mbps', rateLimitMbps: 50 });

      expect(result).toEqual({ ok: true });
      expect(ensureProfile).toHaveBeenCalledWith(
        'Sumtech-50Mbps',
        '50M/50M',
        expect.objectContaining({ onlyOne: true }),
      );
      expect(setPppSecretProfile).not.toHaveBeenCalled();
    });

    it('falla con un mensaje claro si el secreto todavía no existe en el nodo (no lo crea)', async () => {
      nodeRepo.findOneBy.mockResolvedValue(makeNode());
      const ensureProfile = jest.fn();
      clientFactory.mockReturnValue({
        findPppSecretByName: jest.fn().mockResolvedValue(null),
        ensureProfile,
        setPppSecretProfile: jest.fn(),
      });

      const result = await adapter.syncProfile(makeAccess(), { name: 'Sumtech-50Mbps', rateLimitMbps: 50 });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('No existe el secreto PPP');
      expect(ensureProfile).not.toHaveBeenCalled();
    });

    it('falla sin llamar al nodo si el acceso no tiene usuario configurado', async () => {
      const result = await adapter.syncProfile(makeAccess({ username: undefined }), {
        name: 'Sumtech-50Mbps',
        rateLimitMbps: 50,
      });

      expect(result.ok).toBe(false);
      expect(nodeRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('falla con el motivo real si ensureProfile lanza un error (ej. nodo inalcanzable)', async () => {
      nodeRepo.findOneBy.mockResolvedValue(makeNode());
      clientFactory.mockReturnValue({
        findPppSecretByName: jest.fn().mockResolvedValue({ id: '*1', name: 't1@tecmas', disabled: false, profile: 'default' }),
        ensureProfile: jest.fn().mockRejectedValue(new Error('Tiempo de espera agotado contactando al nodo.')),
        setPppSecretProfile: jest.fn(),
      });

      const result = await adapter.syncProfile(makeAccess(), { name: 'Sumtech-50Mbps', rateLimitMbps: 50 });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Tiempo de espera agotado');
    });
  });
});
