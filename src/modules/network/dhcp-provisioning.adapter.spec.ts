import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DhcpProvisioningAdapter } from './dhcp-provisioning.adapter';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { VlanEntity } from '../olt/entities/vlan.entity';
import { ROUTEROS_CLIENT_FACTORY } from './routeros/routeros-client-factory';
import { ReachabilityResolver } from '../network-connectivity/services/reachability-resolver.service';

describe('DhcpProvisioningAdapter', () => {
  let adapter: DhcpProvisioningAdapter;
  let nodeRepo: any;
  let vlanRepo: any;
  let clientFactory: jest.Mock;
  let reachabilityResolver: any;

  const makeNode = (overrides: Partial<NetworkNodeEntity> = {}): NetworkNodeEntity =>
    ({ id: 'node-1', name: 'RB Las Yayas', managementIp: '10.10.0.1', apiPort: 8729, ...overrides }) as NetworkNodeEntity;

  const vlan = { id: 'vlan-1', vlanId: 400, name: 'Clientes DHCP' } as VlanEntity;

  const makeAccess = (overrides: Partial<NetworkAccessEntity> = {}): NetworkAccessEntity =>
    ({
      id: 'access-1',
      contractId: 'contract-1',
      nodeId: 'node-1',
      vlanId: 'vlan-1',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      ipAddress: '10.20.0.50',
      ...overrides,
    }) as NetworkAccessEntity;

  beforeEach(async () => {
    nodeRepo = { findOneBy: jest.fn().mockResolvedValue(makeNode()) };
    vlanRepo = { findOneBy: jest.fn().mockResolvedValue(vlan) };
    clientFactory = jest.fn();
    reachabilityResolver = {
      resolveEndpoint: jest.fn().mockResolvedValue({ host: '10.10.0.1', port: 8729, useHttps: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DhcpProvisioningAdapter,
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: getRepositoryToken(VlanEntity), useValue: vlanRepo },
        { provide: ROUTEROS_CLIENT_FACTORY, useValue: clientFactory },
        { provide: ReachabilityResolver, useValue: reachabilityResolver },
      ],
    }).compile();

    adapter = module.get(DhcpProvisioningAdapter);
    process.env.ROUTEROS_CREDENTIALS = JSON.stringify({ 'RB Las Yayas': { username: 'api', password: 'secret' } });
  });

  afterEach(() => {
    delete process.env.ROUTEROS_CREDENTIALS;
  });

  it('debe estar definido', () => {
    expect(adapter).toBeDefined();
  });

  describe('provision', () => {
    it('falla con mensaje claro si falta macAddress o ipAddress', async () => {
      const result = await adapter.provision(makeAccess({ macAddress: undefined }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/MAC address/);
    });

    it('asegura la lease estática con el servidor derivado de la VLAN (dhcp-vlan<id>)', async () => {
      const ensureStaticLease = jest.fn().mockResolvedValue({});
      clientFactory.mockReturnValue({ ensureStaticLease });

      const result = await adapter.provision(makeAccess());

      expect(result.ok).toBe(true);
      expect(ensureStaticLease).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', '10.20.0.50', 'dhcp-vlan400', 'Contrato:contract-1');
    });

    it('falla con mensaje claro si el acceso no tiene VLAN asignada', async () => {
      const result = await adapter.provision(makeAccess({ vlanId: undefined }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/VLAN/);
    });
  });

  describe('suspend / restore', () => {
    it('suspend deshabilita la lease y la simple-queue si existen', async () => {
      const setLeaseDisabled = jest.fn().mockResolvedValue(undefined);
      const setSimpleQueueDisabled = jest.fn().mockResolvedValue(undefined);
      clientFactory.mockReturnValue({
        findStaticLeaseByMac: jest.fn().mockResolvedValue({ id: '*1', disabled: false }),
        setLeaseDisabled,
        findSimpleQueueByName: jest.fn().mockResolvedValue({ id: '*2', disabled: false }),
        setSimpleQueueDisabled,
      });

      const result = await adapter.suspend(makeAccess());

      expect(result.ok).toBe(true);
      expect(setLeaseDisabled).toHaveBeenCalledWith('*1', true);
      expect(setSimpleQueueDisabled).toHaveBeenCalledWith('*2', true);
    });

    it('restore reactiva la lease y la simple-queue si estaban deshabilitadas', async () => {
      const setLeaseDisabled = jest.fn().mockResolvedValue(undefined);
      const setSimpleQueueDisabled = jest.fn().mockResolvedValue(undefined);
      clientFactory.mockReturnValue({
        findStaticLeaseByMac: jest.fn().mockResolvedValue({ id: '*1', disabled: true }),
        setLeaseDisabled,
        findSimpleQueueByName: jest.fn().mockResolvedValue({ id: '*2', disabled: true }),
        setSimpleQueueDisabled,
      });

      const result = await adapter.restore(makeAccess());

      expect(result.ok).toBe(true);
      expect(setLeaseDisabled).toHaveBeenCalledWith('*1', false);
      expect(setSimpleQueueDisabled).toHaveBeenCalledWith('*2', false);
    });

    it('suspend es un no-op seguro si la lease/queue ya no existen en el router', async () => {
      clientFactory.mockReturnValue({
        findStaticLeaseByMac: jest.fn().mockResolvedValue(null),
        findSimpleQueueByName: jest.fn().mockResolvedValue(null),
      });

      const result = await adapter.suspend(makeAccess());

      expect(result.ok).toBe(true);
    });
  });

  describe('syncProfile', () => {
    it('asegura la simple-queue con rate-limit simétrico sobre la IP/32 del cliente', async () => {
      const ensureSimpleQueue = jest.fn().mockResolvedValue({});
      clientFactory.mockReturnValue({ ensureSimpleQueue });

      const result = await adapter.syncProfile(makeAccess(), { name: 'Sumtech-20Mbps', rateLimitMbps: 20 });

      expect(result.ok).toBe(true);
      expect(ensureSimpleQueue).toHaveBeenCalledWith('sumtech-contract-1', '10.20.0.50/32', '20M/20M');
    });

    it('falla con mensaje claro si el acceso no tiene IP asignada', async () => {
      const result = await adapter.syncProfile(makeAccess({ ipAddress: undefined }), { name: 'x', rateLimitMbps: 20 });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/IP asignada/);
    });
  });
});
