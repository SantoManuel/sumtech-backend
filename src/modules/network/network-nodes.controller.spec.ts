import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';
import { NetworkNodesController } from './network-nodes.controller';
import { NetworkNodesService } from './network-nodes.service';
import { NetworkNodesExportService } from './services/network-nodes-export.service';
import { PppManagementService } from './services/ppp-management.service';
import { NetworkNodeInfrastructureService } from './services/network-node-infrastructure.service';
import { SuspensionPortalManagerService } from './services/suspension-portal-manager.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { Role } from '../../common/enums/role.enum';

describe('NetworkNodesController', () => {
  let controller: NetworkNodesController;
  let service: any;
  let exportService: any;
  let infrastructureService: any;
  const reflector = new Reflector();

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue({ data: [{ id: 'node-1' }], total: 1, page: 1, limit: 20, totalPages: 1 }),
      findById: jest.fn().mockResolvedValue({ id: 'node-1' }),
      create: jest.fn().mockResolvedValue({ id: 'node-new' }),
      update: jest.fn().mockResolvedValue({ id: 'node-1', name: 'Actualizado' }),
      deactivate: jest.fn().mockResolvedValue({ id: 'node-1', isActive: false }),
      reactivate: jest.fn().mockResolvedValue({ id: 'node-1', isActive: true }),
    };

    exportService = {
      export: jest.fn().mockResolvedValue({ buffer: Buffer.from('csv'), filename: 'routers-mikrotik.csv', contentType: 'text/csv; charset=utf-8' }),
    };

    const pppManagementService = {
      getNodeActiveSessions: jest.fn().mockResolvedValue([{ name: 'user1', callerId: 'AA:BB:CC:DD:EE:FF', uptime: '1h' }]),
      disconnectNodeActiveSession: jest.fn().mockResolvedValue({ success: true, message: 'Sesión desconectada' }),
      syncCatalogProfilesToNode: jest.fn().mockResolvedValue({ nodeId: 'node-1', syncedProfiles: [] }),
      createNodeIpPool: jest.fn().mockResolvedValue({ id: '*P1', name: 'pool-test', ranges: '10.50.0.10-10.50.0.100' }),
      updateNodeIpPool: jest.fn().mockResolvedValue({ id: '*P1', ranges: '10.50.0.10-10.50.0.200' }),
      deleteNodeIpPool: jest.fn().mockResolvedValue({ ok: true }),
    };

    const suspensionPortalService = {
      installPortalRules: jest.fn().mockResolvedValue({ success: true, message: 'Portal instalado' }),
      getPortalStatus: jest.fn().mockResolvedValue({ portalInstalled: true, portalRulesStatus: 'INSTALLED' }),
    };

    infrastructureService = {
      listVlans: jest.fn().mockResolvedValue([]),
      syncVlan: jest.fn().mockResolvedValue({ id: 'nv-1', applyStatus: 'APPLIED' }),
      desyncVlan: jest.fn().mockResolvedValue(undefined),
      ensureWan: jest.fn().mockResolvedValue({ id: 'node-1', wanLastSyncAt: new Date() }),
      ensureNatMasquerade: jest.fn().mockResolvedValue({ id: 'node-1' }),
      ensureFirewallBaseline: jest.fn().mockResolvedValue({ id: 'node-1' }),
      ensureDhcpServerForVlan: jest.fn().mockResolvedValue({ id: 'nv-1' }),
      getReconciliationStatus: jest.fn().mockResolvedValue({ vlans: [], nat: true, firewall: true }),
      generateAndDownloadBackup: jest.fn().mockResolvedValue({
        buffer: Buffer.from('backup-data'),
        filename: 'backup_node1.rsc',
        contentType: 'text/plain; charset=utf-8',
      }),
      getRouterOsUpdates: jest.fn().mockResolvedValue({
        channel: 'stable',
        installedVersion: '7.12.1',
        latestVersion: '7.15.3',
        status: 'New version is available',
        updateAvailable: true,
      }),
      getInterfaces: jest.fn().mockResolvedValue([{ id: '*1', name: 'ether1', running: true, disabled: false }]),
      setInterfaceDisabled: jest.fn().mockResolvedValue({ ok: true }),
      getDhcpLeases: jest.fn().mockResolvedValue([{ id: '*L1', address: '10.20.0.50', dynamic: true }]),
      makeDhcpLeaseStatic: jest.fn().mockResolvedValue({ ok: true }),
      deleteDhcpLease: jest.fn().mockResolvedValue({ ok: true }),
      getSimpleQueues: jest.fn().mockResolvedValue([{ id: '*Q1', name: 'q1', target: '10.20.0.50/32' }]),
      applySecurityLockdown: jest.fn().mockResolvedValue({ ok: true }),
      removeSecurityLockdown: jest.fn().mockResolvedValue({ ok: true }),
      applyAntiAbuseTemplate: jest.fn().mockResolvedValue({ ok: true }),
      getRouterOsLogs: jest.fn().mockResolvedValue([{ id: '*1', message: 'test log' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NetworkNodesController],
      providers: [
        { provide: NetworkNodesService, useValue: service },
        { provide: NetworkNodesExportService, useValue: exportService },
        { provide: PppManagementService, useValue: pppManagementService },
        { provide: NetworkNodeInfrastructureService, useValue: infrastructureService },
        { provide: SuspensionPortalManagerService, useValue: suspensionPortalService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: TenantContextService, useValue: { hasContext: jest.fn().mockReturnValue(false), getTenantId: jest.fn(), getSlug: jest.fn() } },
      ],
    }).compile();

    controller = module.get<NetworkNodesController>(NetworkNodesController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('findAll delega en el servicio pasando includeInactive invertido como activeOnly', async () => {
    const result = await controller.findAll({ page: 1, limit: 20, includeInactive: true } as any);
    expect(result.data).toHaveLength(1);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, includeInactive: true }, false);
  });

  it('findAll pide solo nodos activos por defecto cuando no se pide includeInactive', async () => {
    await controller.findAll({ page: 1, limit: 20 } as any);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 }, true);
  });

  it('findAll respeta activeOnly explícito si se provee en la query', async () => {
    await controller.findAll({ page: 1, limit: 20, activeOnly: true } as any);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, activeOnly: true }, true);
  });

  it('findById delega en el servicio con el id', async () => {
    await controller.findById('node-1');
    expect(service.findById).toHaveBeenCalledWith('node-1');
  });

  it('create delega en el servicio con el DTO', async () => {
    const dto = { name: 'Nuevo Nodo' } as any;
    await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('update delega en el servicio con id y DTO', async () => {
    await controller.update('node-1', { model: 'RB5009UG+S+' } as any);
    expect(service.update).toHaveBeenCalledWith('node-1', { model: 'RB5009UG+S+' });
  });

  it('deactivate delega en el servicio con el id', async () => {
    await controller.deactivate('node-1');
    expect(service.deactivate).toHaveBeenCalledWith('node-1');
  });

  it('reactivate delega en el servicio con el id', async () => {
    await controller.reactivate('node-1');
    expect(service.reactivate).toHaveBeenCalledWith('node-1');
  });

  it('getNodeVlans delega en NetworkNodeInfrastructureService.listVlans', async () => {
    await controller.getNodeVlans('node-1');
    expect(infrastructureService.listVlans).toHaveBeenCalledWith('node-1');
  });

  it('syncNodeVlan delega en NetworkNodeInfrastructureService.syncVlan con nodo, vlan, dto y actor', async () => {
    const dto = { uplinkInterface: 'ether5', gatewayCidr: '10.20.0.1/24' };
    await controller.syncNodeVlan('node-1', 'vlan-1', dto as any, 'admin-1');
    expect(infrastructureService.syncVlan).toHaveBeenCalledWith('node-1', 'vlan-1', dto, 'admin-1');
  });

  it('syncNodeWan delega en NetworkNodeInfrastructureService.ensureWan con nodo y actor', async () => {
    await controller.syncNodeWan('node-1', 'admin-1');
    expect(infrastructureService.ensureWan).toHaveBeenCalledWith('node-1', 'admin-1');
  });

  it('ensureNodeVlanDhcpServer delega en NetworkNodeInfrastructureService.ensureDhcpServerForVlan', async () => {
    const dto = { poolRange: '10.20.0.10-10.20.0.250' };
    await controller.ensureNodeVlanDhcpServer('node-1', 'vlan-1', dto as any, 'admin-1');
    expect(infrastructureService.ensureDhcpServerForVlan).toHaveBeenCalledWith('node-1', 'vlan-1', dto, 'admin-1');
  });

  it('ensureNodeNatMasquerade delega en NetworkNodeInfrastructureService.ensureNatMasquerade', async () => {
    await controller.ensureNodeNatMasquerade('node-1', 'admin-1');
    expect(infrastructureService.ensureNatMasquerade).toHaveBeenCalledWith('node-1', 'admin-1');
  });

  it('ensureNodeFirewallBaseline delega en NetworkNodeInfrastructureService.ensureFirewallBaseline', async () => {
    await controller.ensureNodeFirewallBaseline('node-1', 'admin-1');
    expect(infrastructureService.ensureFirewallBaseline).toHaveBeenCalledWith('node-1', 'admin-1');
  });

  it('desyncNodeVlan delega en NetworkNodeInfrastructureService.desyncVlan y responde {ok: true}', async () => {
    const result = await controller.desyncNodeVlan('node-1', 'vlan-1', 'admin-1');
    expect(infrastructureService.desyncVlan).toHaveBeenCalledWith('node-1', 'vlan-1', 'admin-1');
    expect(result).toEqual({ ok: true });
  });

  it('getNodeReconciliationStatus delega en NetworkNodeInfrastructureService.getReconciliationStatus', async () => {
    const result = await controller.getNodeReconciliationStatus('node-1');
    expect(infrastructureService.getReconciliationStatus).toHaveBeenCalledWith('node-1');
    expect(result).toEqual({ vlans: [], nat: true, firewall: true });
  });

  describe('exportNodes', () => {
    it('delega en NetworkNodesExportService.export con el DTO', async () => {
      const dto: any = { status: 'ACTIVE' };
      const res: any = { set: jest.fn(), end: jest.fn() };

      await controller.exportNodes(dto, res);

      expect(exportService.export).toHaveBeenCalledWith(dto);
    });

    it('setea Content-Type, Content-Disposition (attachment) y Content-Length, y escribe el buffer', async () => {
      const dto: any = {};
      const res: any = { set: jest.fn(), end: jest.fn() };
      const buffer = Buffer.from('csv-content');
      exportService.export.mockResolvedValueOnce({
        buffer,
        filename: 'routers-mikrotik_20261010_2100.csv',
        contentType: 'text/csv; charset=utf-8',
      });

      await controller.exportNodes(dto, res);

      expect(res.set).toHaveBeenCalledWith({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="routers-mikrotik_20261010_2100.csv"',
        'Content-Length': buffer.length,
      });
      expect(res.end).toHaveBeenCalledWith(buffer);
    });
  });

  describe('Fase 2: Respaldos y Actualizaciones RouterOS', () => {
    it('downloadBackup delega en infrastructureService y envía el buffer al navegador', async () => {
      const res: any = { set: jest.fn(), end: jest.fn() };
      await controller.downloadBackup('node-1', { type: 'RSC' }, res, 'admin-user');

      expect(infrastructureService.generateAndDownloadBackup).toHaveBeenCalledWith(
        'node-1',
        { type: 'RSC' },
        'admin-user',
      );
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="backup_node1.rsc"',
      }));
      expect(res.end).toHaveBeenCalledWith(Buffer.from('backup-data'));
    });

    it('getRouterOsUpdates delega en infrastructureService.getRouterOsUpdates', async () => {
      const result = await controller.getRouterOsUpdates('node-1');
      expect(infrastructureService.getRouterOsUpdates).toHaveBeenCalledWith('node-1');
      expect(result.updateAvailable).toBe(true);
    });
  });

  describe('Fase 3: Interfaces Físicas, Pools y Leases DHCP', () => {
    it('getNodeInterfaces delega en infrastructureService.getInterfaces', async () => {
      const result = await controller.getNodeInterfaces('node-1');
      expect(infrastructureService.getInterfaces).toHaveBeenCalledWith('node-1');
      expect(result).toHaveLength(1);
    });

    it('setNodeInterfaceDisabled delega en infrastructureService.setInterfaceDisabled', async () => {
      const result = await controller.setNodeInterfaceDisabled('node-1', 'ether2', { disabled: true }, 'admin');
      expect(infrastructureService.setInterfaceDisabled).toHaveBeenCalledWith('node-1', 'ether2', true, 'admin');
      expect(result.ok).toBe(true);
    });

    it('createNodeIpPool delega en pppManagementService.createNodeIpPool', async () => {
      const result = await controller.createNodeIpPool('node-1', { name: 'pool-test', ranges: '10.50.0.10-10.50.0.100' }, 'admin');
      expect(result.id).toBe('*P1');
    });

    it('updateNodeIpPool delega en pppManagementService.updateNodeIpPool', async () => {
      const result = await controller.updateNodeIpPool('node-1', '*P1', { ranges: '10.50.0.10-10.50.0.200' }, 'admin');
      expect(result.ranges).toBe('10.50.0.10-10.50.0.200');
    });

    it('deleteNodeIpPool delega en pppManagementService.deleteNodeIpPool', async () => {
      const result = await controller.deleteNodeIpPool('node-1', '*P1', 'admin');
      expect(result.ok).toBe(true);
    });

    it('getNodeDhcpLeases delega en infrastructureService.getDhcpLeases', async () => {
      const result = await controller.getNodeDhcpLeases('node-1');
      expect(result).toHaveLength(1);
    });

    it('makeNodeDhcpLeaseStatic delega en infrastructureService.makeDhcpLeaseStatic', async () => {
      const result = await controller.makeNodeDhcpLeaseStatic('node-1', '*L1', { comment: 'Static' }, 'admin');
      expect(result.ok).toBe(true);
    });

    it('deleteNodeDhcpLease delega en infrastructureService.deleteDhcpLease', async () => {
      const result = await controller.deleteNodeDhcpLease('node-1', '*L1', 'admin');
      expect(result.ok).toBe(true);
    });
  });

  describe('Fase 4: Simple Queues', () => {
    it('getNodeSimpleQueues delega en infrastructureService.getSimpleQueues', async () => {
      const result = await controller.getNodeSimpleQueues('node-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('Fase 5: Seguridad y Logs', () => {
    it('applySecurityLockdown delega en infrastructureService.applySecurityLockdown', async () => {
      const result = await controller.applySecurityLockdown('node-1', { allowedIps: ['1.2.3.4'] }, 'admin');
      expect(result.ok).toBe(true);
    });

    it('removeSecurityLockdown delega en infrastructureService.removeSecurityLockdown', async () => {
      const result = await controller.removeSecurityLockdown('node-1', 'admin');
      expect(result.ok).toBe(true);
    });

    it('applyAntiAbuseTemplate delega en infrastructureService.applyAntiAbuseTemplate', async () => {
      const result = await controller.applyAntiAbuseTemplate('node-1', { template: 'BLOCK_SMTP_PORT25', enabled: true }, 'admin');
      expect(result.ok).toBe(true);
    });

    it('getNodeRouterOsLogs delega en infrastructureService.getRouterOsLogs', async () => {
      const result = await controller.getNodeRouterOsLogs('node-1', 'system,info');
      expect(infrastructureService.getRouterOsLogs).toHaveBeenCalledWith('node-1', 'system,info');
      expect(result).toHaveLength(1);
    });
  });

  describe('metadatos de guards (roles)', () => {
    it('todos los endpoints exigen rol ADMIN o GERENTE', () => {
      expect(reflector.get(ROLES_KEY, controller.findAll)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.findById)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.create)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.update)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.deactivate)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.reactivate)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.exportNodes)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.disconnectNodeActiveSession)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.downloadBackup)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.getRouterOsUpdates)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.getNodeInterfaces)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.setNodeInterfaceDisabled)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.createNodeIpPool)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.getNodeDhcpLeases)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.getNodeSimpleQueues)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.applySecurityLockdown)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.getNodeRouterOsLogs)).toEqual([Role.ADMIN, Role.GERENTE]);
    });

    it('ningún endpoint es público: este catálogo es interno, no de cara al cliente', () => {
      expect(reflector.get(IS_PUBLIC_KEY, controller.findAll)).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, controller.findById)).toBeUndefined();
    });
  });
});
