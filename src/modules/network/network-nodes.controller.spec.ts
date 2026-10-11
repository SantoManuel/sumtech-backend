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
      syncCatalogProfilesToNode: jest.fn().mockResolvedValue({ nodeId: 'node-1', syncedProfiles: [] }),
    };

    const suspensionPortalService = {
      installPortalRules: jest.fn().mockResolvedValue({ success: true, message: 'Portal instalado' }),
      getPortalStatus: jest.fn().mockResolvedValue({ portalInstalled: true, portalRulesStatus: 'INSTALLED' }),
    };

    infrastructureService = {
      listVlans: jest.fn().mockResolvedValue([]),
      syncVlan: jest.fn().mockResolvedValue({ id: 'nv-1', applyStatus: 'APPLIED' }),
      ensureWan: jest.fn().mockResolvedValue({ id: 'node-1', wanLastSyncAt: new Date() }),
      ensureNatMasquerade: jest.fn().mockResolvedValue({ id: 'node-1' }),
      ensureFirewallBaseline: jest.fn().mockResolvedValue({ id: 'node-1' }),
      ensureDhcpServerForVlan: jest.fn().mockResolvedValue({ id: 'nv-1' }),
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

  describe('metadatos de guards (roles)', () => {
    it('todos los endpoints exigen rol ADMIN o GERENTE', () => {
      expect(reflector.get(ROLES_KEY, controller.findAll)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.findById)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.create)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.update)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.deactivate)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.reactivate)).toEqual([Role.ADMIN, Role.GERENTE]);
      expect(reflector.get(ROLES_KEY, controller.exportNodes)).toEqual([Role.ADMIN, Role.GERENTE]);
    });

    it('ningún endpoint es público: este catálogo es interno, no de cara al cliente', () => {
      expect(reflector.get(IS_PUBLIC_KEY, controller.findAll)).toBeUndefined();
      expect(reflector.get(IS_PUBLIC_KEY, controller.findById)).toBeUndefined();
    });
  });
});
