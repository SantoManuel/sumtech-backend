import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NetworkNodeInfrastructureService } from './network-node-infrastructure.service';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import { NetworkNodeVlanEntity } from '../entities/network-node-vlan.entity';
import { VlanEntity } from '../../olt/entities/vlan.entity';
import { ROUTEROS_CLIENT_FACTORY } from '../routeros/routeros-client-factory';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';
import { encryptCredential } from '../../network-connectivity/utils/crypto.util';

describe('NetworkNodeInfrastructureService', () => {
  let service: NetworkNodeInfrastructureService;
  let nodeRepo: any;
  let nodeVlanRepo: any;
  let vlanRepo: any;
  let clientFactory: jest.Mock;
  let reachabilityResolver: any;
  let deviceOperationLogger: any;

  const node = { id: 'node-1', name: 'RB Las Yayas', managementIp: '10.10.0.1', apiPort: 8729 } as NetworkNodeEntity;
  const vlan = { id: 'vlan-1', vlanId: 400, name: 'Clientes Internet' } as VlanEntity;

  beforeEach(async () => {
    nodeRepo = {
      findOneBy: jest.fn().mockResolvedValue(node),
      save: jest.fn((entity) => Promise.resolve({ ...entity })),
    };
    nodeVlanRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((entity) => Promise.resolve({ ...entity, id: entity.id || 'nv-1' })),
      find: jest.fn(),
    };
    vlanRepo = { findOneBy: jest.fn().mockResolvedValue(vlan) };
    clientFactory = jest.fn();
    reachabilityResolver = {
      resolveEndpoint: jest.fn().mockResolvedValue({ host: '10.10.0.1', port: 8729, useHttps: false }),
    };
    deviceOperationLogger = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NetworkNodeInfrastructureService,
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: getRepositoryToken(NetworkNodeVlanEntity), useValue: nodeVlanRepo },
        { provide: getRepositoryToken(VlanEntity), useValue: vlanRepo },
        { provide: ROUTEROS_CLIENT_FACTORY, useValue: clientFactory },
        { provide: ReachabilityResolver, useValue: reachabilityResolver },
        { provide: DeviceOperationLogger, useValue: deviceOperationLogger },
      ],
    }).compile();

    service = module.get(NetworkNodeInfrastructureService);
    process.env.ROUTEROS_CREDENTIALS = JSON.stringify({ 'RB Las Yayas': { username: 'api', password: 'secret' } });
  });

  afterEach(() => {
    delete process.env.ROUTEROS_CREDENTIALS;
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('lanza NotFoundException si el nodo no existe', async () => {
    nodeRepo.findOneBy.mockResolvedValue(null);
    await expect(service.syncVlan('node-x', 'vlan-1', { uplinkInterface: 'ether5' })).rejects.toThrow(NotFoundException);
  });

  it('lanza NotFoundException si la VLAN no existe', async () => {
    vlanRepo.findOneBy.mockResolvedValue(null);
    await expect(service.syncVlan('node-1', 'vlan-x', { uplinkInterface: 'ether5' })).rejects.toThrow(NotFoundException);
  });

  it('sincroniza la VLAN: ensureVlanInterface + ensureIpAddress, guarda APPLIED y loguea SUCCESS', async () => {
    const ensureVlanInterface = jest.fn().mockResolvedValue({ id: '*1', name: 'vlan400', vlanId: 400, interface: 'ether5' });
    const ensureIpAddress = jest.fn().mockResolvedValue({ id: '*2', address: '10.20.0.1/24', interface: 'vlan400' });
    clientFactory.mockReturnValue({ ensureVlanInterface, ensureIpAddress });

    const result = await service.syncVlan('node-1', 'vlan-1', { uplinkInterface: 'ether5', gatewayCidr: '10.20.0.1/24' }, 'admin-1');

    expect(ensureVlanInterface).toHaveBeenCalledWith({
      name: 'vlan400',
      vlanId: 400,
      parentInterface: 'ether5',
      comment: 'Sumtech - Clientes Internet',
    });
    expect(ensureIpAddress).toHaveBeenCalledWith('vlan400', '10.20.0.1/24', 'Sumtech - Gateway Clientes Internet');
    expect(result.applyStatus).toBe('APPLIED');
    expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUCCESS', nodeId: 'node-1' }),
    );
  });

  it('sin gatewayCidr, no llama a ensureIpAddress', async () => {
    const ensureVlanInterface = jest.fn().mockResolvedValue({ id: '*1', name: 'vlan400', vlanId: 400, interface: 'ether5' });
    const ensureIpAddress = jest.fn();
    clientFactory.mockReturnValue({ ensureVlanInterface, ensureIpAddress });

    await service.syncVlan('node-1', 'vlan-1', { uplinkInterface: 'ether5' });

    expect(ensureIpAddress).not.toHaveBeenCalled();
  });

  it('si el router rechaza la operación, guarda ERROR con el mensaje y loguea FAILURE, y relanza', async () => {
    const ensureVlanInterface = jest.fn().mockRejectedValue(new Error('El nodo respondió con error 400'));
    clientFactory.mockReturnValue({ ensureVlanInterface });

    await expect(service.syncVlan('node-1', 'vlan-1', { uplinkInterface: 'ether5' })).rejects.toThrow(
      'El nodo respondió con error 400',
    );

    expect(nodeVlanRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ applyStatus: 'ERROR', lastSyncError: 'El nodo respondió con error 400' }),
    );
    expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILURE' }));
  });

  describe('ensureWan', () => {
    it('lanza BadRequestException si el nodo no tiene wanInterfaceName', async () => {
      nodeRepo.findOneBy.mockResolvedValue({ ...node, wanInterfaceName: undefined });
      await expect(service.ensureWan('node-1')).rejects.toThrow(BadRequestException);
    });

    it('modo DHCP_CLIENT (default): llama ensureDhcpClient y no toca rutas', async () => {
      const ensureDhcpClient = jest.fn().mockResolvedValue({ id: '*1', interface: 'ether1', disabled: false });
      const ensureDefaultRoute = jest.fn();
      clientFactory.mockReturnValue({ ensureDhcpClient, ensureDefaultRoute });
      nodeRepo.findOneBy.mockResolvedValue({ ...node, wanInterfaceName: 'ether1', wanMode: 'DHCP_CLIENT' });

      const result = await service.ensureWan('node-1', 'admin-1');

      expect(ensureDhcpClient).toHaveBeenCalledWith('ether1', true);
      expect(ensureDefaultRoute).not.toHaveBeenCalled();
      expect(result.wanLastSyncError).toBeUndefined();
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCESS' }));
    });

    it('modo STATIC: exige IP+gateway, luego ensureIpAddress + ensureDefaultRoute', async () => {
      const ensureIpAddress = jest.fn().mockResolvedValue({});
      const ensureDefaultRoute = jest.fn().mockResolvedValue({});
      clientFactory.mockReturnValue({ ensureIpAddress, ensureDefaultRoute });
      nodeRepo.findOneBy.mockResolvedValue({
        ...node,
        wanInterfaceName: 'ether1',
        wanMode: 'STATIC',
        wanStaticIp: '200.1.1.2/30',
        wanStaticGateway: '200.1.1.1',
      });

      await service.ensureWan('node-1');

      expect(ensureIpAddress).toHaveBeenCalledWith('ether1', '200.1.1.2/30', 'Sumtech - WAN estática');
      expect(ensureDefaultRoute).toHaveBeenCalledWith('200.1.1.1', 'Sumtech - WAN estática');
    });

    it('modo STATIC sin gateway: lanza BadRequestException y no llama al router', async () => {
      clientFactory.mockReturnValue({});
      nodeRepo.findOneBy.mockResolvedValue({ ...node, wanInterfaceName: 'ether1', wanMode: 'STATIC', wanStaticIp: '200.1.1.2/30' });

      await expect(service.ensureWan('node-1')).rejects.toThrow(BadRequestException);
    });

    it('modo PPPOE_CLIENT: desencripta la contraseña y llama ensurePppoeClient', async () => {
      const ensurePppoeClient = jest.fn().mockResolvedValue({});
      clientFactory.mockReturnValue({ ensurePppoeClient });
      nodeRepo.findOneBy.mockResolvedValue({
        ...node,
        wanInterfaceName: 'ether1',
        wanMode: 'PPPOE_CLIENT',
        wanPppoeUsername: 'isp-user',
        wanPppoePasswordEnc: encryptCredential('isp-pass'),
      });

      await service.ensureWan('node-1');

      expect(ensurePppoeClient).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'sumtech-wan-pppoe', parentInterface: 'ether1', user: 'isp-user', password: 'isp-pass' }),
      );
    });
  });

  describe('ensureDhcpServerForVlan', () => {
    it('lanza NotFoundException si no hay una VLAN sincronizada para ese nodo', async () => {
      nodeVlanRepo.findOne = jest.fn().mockResolvedValue(null);
      await expect(
        service.ensureDhcpServerForVlan('node-1', 'vlan-1', { poolRange: '10.20.0.10-10.20.0.250' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si la VLAN sincronizada no tiene gatewayCidr', async () => {
      nodeVlanRepo.findOne = jest.fn().mockResolvedValue({ nodeId: 'node-1', vlanId: 'vlan-1', vlan, node, gatewayCidr: undefined });
      await expect(
        service.ensureDhcpServerForVlan('node-1', 'vlan-1', { poolRange: '10.20.0.10-10.20.0.250' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deriva la dirección de red desde el gatewayCidr y llama ensureIpPool + ensureDhcpServerNetwork + ensureDhcpServer', async () => {
      nodeVlanRepo.findOne = jest.fn().mockResolvedValue({
        nodeId: 'node-1',
        vlanId: 'vlan-1',
        vlan,
        node,
        gatewayCidr: '10.20.0.1/24',
      });
      const ensureIpPool = jest.fn().mockResolvedValue({});
      const ensureDhcpServerNetwork = jest.fn().mockResolvedValue(undefined);
      const ensureDhcpServer = jest.fn().mockResolvedValue({});
      clientFactory.mockReturnValue({ ensureIpPool, ensureDhcpServerNetwork, ensureDhcpServer });

      await service.ensureDhcpServerForVlan('node-1', 'vlan-1', {
        poolRange: '10.20.0.10-10.20.0.250',
        dnsServers: '8.8.8.8',
      });

      expect(ensureIpPool).toHaveBeenCalledWith('pool-vlan400', '10.20.0.10-10.20.0.250');
      expect(ensureDhcpServerNetwork).toHaveBeenCalledWith('10.20.0.0/24', '10.20.0.1', '8.8.8.8');
      expect(ensureDhcpServer).toHaveBeenCalledWith('dhcp-vlan400', 'vlan400', 'pool-vlan400', 86400);
    });
  });

  describe('ensureNatMasquerade', () => {
    it('lanza BadRequestException si falta wanInterfaceName', async () => {
      nodeRepo.findOneBy.mockResolvedValue({ ...node, wanInterfaceName: undefined });
      await expect(service.ensureNatMasquerade('node-1')).rejects.toThrow(BadRequestException);
    });

    it('llama ensureNatMasquerade del cliente con la interfaz WAN y loguea SUCCESS', async () => {
      const ensureNatMasquerade = jest.fn().mockResolvedValue(undefined);
      clientFactory.mockReturnValue({ ensureNatMasquerade });
      nodeRepo.findOneBy.mockResolvedValue({ ...node, wanInterfaceName: 'ether1' });

      await service.ensureNatMasquerade('node-1', 'admin-1');

      expect(ensureNatMasquerade).toHaveBeenCalledWith('ether1', 'sumtech-nat-masquerade');
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCESS' }));
    });
  });

  describe('ensureFirewallBaseline', () => {
    it('lanza NotFoundException si el nodo no existe', async () => {
      nodeRepo.findOneBy.mockResolvedValue(null);
      await expect(service.ensureFirewallBaseline('node-x')).rejects.toThrow(NotFoundException);
    });

    it('llama ensureFirewallBaseline del cliente y loguea SUCCESS', async () => {
      const ensureFirewallBaseline = jest.fn().mockResolvedValue(undefined);
      clientFactory.mockReturnValue({ ensureFirewallBaseline });

      await service.ensureFirewallBaseline('node-1', 'admin-1');

      expect(ensureFirewallBaseline).toHaveBeenCalled();
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCESS' }));
    });

    it('loguea FAILURE y relanza si el router rechaza la operación', async () => {
      const ensureFirewallBaseline = jest.fn().mockRejectedValue(new Error('timeout'));
      clientFactory.mockReturnValue({ ensureFirewallBaseline });

      await expect(service.ensureFirewallBaseline('node-1')).rejects.toThrow('timeout');
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILURE' }));
    });
  });

  describe('getIpAddresses', () => {
    it('lanza NotFoundException si el nodo no existe', async () => {
      nodeRepo.findOneBy.mockResolvedValue(null);
      await expect(service.getIpAddresses('node-x')).rejects.toThrow(NotFoundException);
    });

    it('devuelve las IPs reales configuradas en el router', async () => {
      const getIpAddresses = jest.fn().mockResolvedValue([
        { id: '*1', address: '192.168.0.1/24', interface: 'ether2-lab' },
      ]);
      clientFactory.mockReturnValue({ getIpAddresses });

      const result = await service.getIpAddresses('node-1');

      expect(result).toEqual([{ id: '*1', address: '192.168.0.1/24', interface: 'ether2-lab' }]);
    });
  });

  describe('ensureAcsAutoProvisioning', () => {
    it('lanza NotFoundException si el nodo no existe', async () => {
      nodeRepo.findOneBy.mockResolvedValue(null);
      await expect(service.ensureAcsAutoProvisioning('node-x', 'http://66.94.107.219:7547')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('llama ensureAcsAutoProvisioning del cliente con la URL del ACS y loguea SUCCESS', async () => {
      const ensureAcsAutoProvisioning = jest.fn().mockResolvedValue({ name: 'sumtech-tr069-dslforum' });
      clientFactory.mockReturnValue({ ensureAcsAutoProvisioning });

      await service.ensureAcsAutoProvisioning('node-1', 'http://66.94.107.219:7547', 'admin-1');

      expect(ensureAcsAutoProvisioning).toHaveBeenCalledWith('http://66.94.107.219:7547');
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SUCCESS', rawDetails: expect.objectContaining({ acsUrl: 'http://66.94.107.219:7547' }) }),
      );
    });

    it('loguea FAILURE y relanza si el router rechaza la operación', async () => {
      const ensureAcsAutoProvisioning = jest.fn().mockRejectedValue(new Error('timeout'));
      clientFactory.mockReturnValue({ ensureAcsAutoProvisioning });

      await expect(service.ensureAcsAutoProvisioning('node-1', 'http://66.94.107.219:7547')).rejects.toThrow('timeout');
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILURE' }));
    });
  });

  it('es idempotente: si ya existe un registro para ese nodo+VLAN, lo actualiza en vez de crear uno nuevo', async () => {
    nodeVlanRepo.findOneBy.mockResolvedValue({
      id: 'nv-existing',
      nodeId: 'node-1',
      vlanId: 'vlan-1',
      uplinkInterface: 'ether4',
      applyStatus: 'APPLIED',
    });
    clientFactory.mockReturnValue({
      ensureVlanInterface: jest.fn().mockResolvedValue({}),
      ensureIpAddress: jest.fn().mockResolvedValue({}),
    });

    await service.syncVlan('node-1', 'vlan-1', { uplinkInterface: 'ether5' });

    expect(nodeVlanRepo.create).not.toHaveBeenCalled();
    expect(nodeVlanRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'nv-existing', uplinkInterface: 'ether5' }));
  });
});
