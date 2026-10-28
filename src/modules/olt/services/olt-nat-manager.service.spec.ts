import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OltNatManagerService } from './olt-nat-manager.service';
import { OltEntity } from '../entities/olt.entity';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { RouterOsClientResolverService } from '../../network/services/routeros-client-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';

describe('OltNatManagerService', () => {
  let service: OltNatManagerService;
  let oltRepo: any;
  let nodeRepo: any;
  let clientResolver: any;
  let deviceOperationLogger: any;
  let fakeClient: {
    findNatRuleByComment: jest.Mock;
    addFirewallNatRule: jest.Mock;
    updateFirewallNatRule: jest.Mock;
  };

  const mockOlt = {
    id: 'olt-1',
    name: 'OLT-Azua_',
    connectionMethod: 'VIA_MIKROTIK',
    viaNodeId: 'node-1',
    natPort: 2324,
    host: '192.168.0.88',
    port: 23,
  } as unknown as OltEntity;

  const mockNode = {
    id: 'node-1',
    name: 'Azua-Centro',
  } as unknown as NetworkNodeEntity;

  beforeEach(async () => {
    oltRepo = { findOneBy: jest.fn().mockResolvedValue(mockOlt) };
    nodeRepo = { findOneBy: jest.fn().mockResolvedValue(mockNode) };

    fakeClient = {
      findNatRuleByComment: jest.fn().mockResolvedValue(null),
      addFirewallNatRule: jest.fn().mockResolvedValue(undefined),
      updateFirewallNatRule: jest.fn().mockResolvedValue(undefined),
    };
    clientResolver = { resolveClient: jest.fn().mockResolvedValue(fakeClient) };
    deviceOperationLogger = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OltNatManagerService,
        { provide: getRepositoryToken(OltEntity), useValue: oltRepo },
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: RouterOsClientResolverService, useValue: clientResolver },
        { provide: DeviceOperationLogger, useValue: deviceOperationLogger },
      ],
    }).compile();

    service = module.get<OltNatManagerService>(OltNatManagerService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('resuelve el cliente RouterOS correcto para el nodo asignado (REST o API Binaria según transportType, vía el resolver compartido)', async () => {
    await service.ensureOltNatRule('olt-1', 'admin-id');
    expect(clientResolver.resolveClient).toHaveBeenCalledWith(mockNode);
  });

  it('crea la regla DST-NAT cuando todavía no existe (busca por comentario, no encuentra, hace addFirewallNatRule)', async () => {
    fakeClient.findNatRuleByComment.mockResolvedValue(null);

    const result = await service.ensureOltNatRule('olt-1', 'admin-id');

    expect(fakeClient.findNatRuleByComment).toHaveBeenCalledWith('Sumtech-OLT-OLT-Azua_');
    expect(fakeClient.addFirewallNatRule).toHaveBeenCalledWith({
      chain: 'dstnat',
      protocol: 'tcp',
      'dst-port': '2324',
      action: 'dst-nat',
      'to-addresses': '192.168.0.88',
      'to-ports': '23',
      comment: 'Sumtech-OLT-OLT-Azua_',
    });
    expect(fakeClient.updateFirewallNatRule).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      nodeId: 'node-1',
      nodeName: 'Azua-Centro',
      natPort: 2324,
      target: '192.168.0.88:23',
    });
  });

  it('actualiza la regla DST-NAT existente en vez de duplicarla (encuentra por comentario, hace updateFirewallNatRule por .id)', async () => {
    fakeClient.findNatRuleByComment.mockResolvedValue({ id: '*7' });

    await service.ensureOltNatRule('olt-1', 'admin-id');

    expect(fakeClient.updateFirewallNatRule).toHaveBeenCalledWith(
      '*7',
      expect.objectContaining({ 'to-addresses': '192.168.0.88', 'to-ports': '23' }),
    );
    expect(fakeClient.addFirewallNatRule).not.toHaveBeenCalled();
  });

  it('usa el puerto NAT por defecto (2323) si la OLT no tiene uno propio configurado', async () => {
    oltRepo.findOneBy.mockResolvedValue({ ...mockOlt, natPort: null });

    await service.ensureOltNatRule('olt-1');

    expect(fakeClient.addFirewallNatRule).toHaveBeenCalledWith(expect.objectContaining({ 'dst-port': '2323' }));
  });

  it('registra el evento de éxito en DeviceOperationLogger', async () => {
    await service.ensureOltNatRule('olt-1', 'admin-id');

    expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'node-1',
        eventType: 'COMMAND',
        status: 'SUCCESS',
        actorUserId: 'admin-id',
      }),
    );
  });

  it('lanza BadRequestException si la OLT no usa VIA_MIKROTIK', async () => {
    oltRepo.findOneBy.mockResolvedValue({ ...mockOlt, connectionMethod: 'WIREGUARD' });
    await expect(service.ensureOltNatRule('olt-1')).rejects.toThrow(BadRequestException);
    expect(clientResolver.resolveClient).not.toHaveBeenCalled();
  });

  it('lanza BadRequestException si la OLT no tiene viaNodeId asignado', async () => {
    oltRepo.findOneBy.mockResolvedValue({ ...mockOlt, viaNodeId: null });
    await expect(service.ensureOltNatRule('olt-1')).rejects.toThrow(BadRequestException);
  });

  it('lanza NotFoundException si la OLT no existe', async () => {
    oltRepo.findOneBy.mockResolvedValue(null);
    await expect(service.ensureOltNatRule('olt-x')).rejects.toThrow(NotFoundException);
  });

  it('lanza NotFoundException si el router MikroTik asignado no existe', async () => {
    nodeRepo.findOneBy.mockResolvedValue(null);
    await expect(service.ensureOltNatRule('olt-1')).rejects.toThrow(NotFoundException);
  });

  it('envuelve cualquier fallo del cliente RouterOS en un BadRequestException con el mensaje real', async () => {
    fakeClient.addFirewallNatRule.mockRejectedValue(new Error('El nodo no respondió a tiempo.'));
    await expect(service.ensureOltNatRule('olt-1')).rejects.toThrow(/El nodo no respondió a tiempo\./);
  });

  it('envuelve el rechazo del resolver (ej. nodo con transportType SSH) en un BadRequestException', async () => {
    clientResolver.resolveClient.mockRejectedValue(
      new BadRequestException('El nodo "Azua-Centro" usa el Protocolo "SSH", que no soporta gestión estructurada.'),
    );
    await expect(service.ensureOltNatRule('olt-1')).rejects.toThrow(BadRequestException);
    await expect(service.ensureOltNatRule('olt-1')).rejects.toThrow(/no soporta gestión estructurada/);
  });
});
