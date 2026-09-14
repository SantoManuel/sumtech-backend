import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { RouterOsShadowSyncService } from './routeros-shadow-sync.service';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { ProvisioningAuditLogEntity } from './entities/provisioning-audit-log.entity';
import { ROUTEROS_CLIENT_FACTORY } from './routeros/routeros-client-factory';

describe('RouterOsShadowSyncService', () => {
  let service: RouterOsShadowSyncService;
  let nodeRepo: any;
  let accessRepo: any;
  let auditRepo: any;
  let clientFactory: jest.Mock;

  const makeNode = (overrides: Partial<NetworkNodeEntity> = {}): NetworkNodeEntity =>
    ({ id: 'node-1', name: 'RB Las Yayas', managementIp: '10.10.0.1', apiPort: 8729, ...overrides }) as NetworkNodeEntity;

  const makeAccess = (overrides: Partial<NetworkAccessEntity> = {}): NetworkAccessEntity =>
    ({
      id: 'access-1',
      contractId: 'contract-1',
      nodeId: 'node-1',
      username: 't1@tecmas',
      connectionStatus: 'SUSPENDED',
      ...overrides,
    }) as NetworkAccessEntity;

  beforeEach(async () => {
    nodeRepo = { findOneBy: jest.fn(), update: jest.fn() };
    accessRepo = { find: jest.fn(), update: jest.fn() };
    auditRepo = { create: jest.fn((dto: any) => dto), save: jest.fn((entity: any) => Promise.resolve(entity)) };
    clientFactory = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouterOsShadowSyncService,
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: getRepositoryToken(NetworkAccessEntity), useValue: accessRepo },
        { provide: getRepositoryToken(ProvisioningAuditLogEntity), useValue: auditRepo },
        { provide: ROUTEROS_CLIENT_FACTORY, useValue: clientFactory },
      ],
    }).compile();

    service = module.get<RouterOsShadowSyncService>(RouterOsShadowSyncService);

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

    await expect(service.checkNode('node-x')).rejects.toThrow(NotFoundException);
  });

  it('lanza BadRequestException si el nodo no tiene IP de gestión configurada', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode({ managementIp: undefined }));

    await expect(service.checkNode('node-1')).rejects.toThrow(BadRequestException);
  });

  it('propaga el error de credenciales si ROUTEROS_CREDENTIALS no tiene este nodo', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    process.env.ROUTEROS_CREDENTIALS = JSON.stringify({});

    await expect(service.checkNode('node-1')).rejects.toThrow(/No hay credenciales configuradas/);
  });

  it('si no se puede conectar al nodo, marca lastSyncStatus=ERROR y no compara ningún acceso', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    clientFactory.mockReturnValue({
      testConnection: jest.fn().mockResolvedValue({ ok: false, error: 'timeout' }),
      findPppSecretByName: jest.fn(),
    });

    const summary = await service.checkNode('node-1');

    expect(summary.connectionOk).toBe(false);
    expect(summary.connectionError).toBe('timeout');
    expect(summary.rows).toHaveLength(0);
    expect(accessRepo.find).not.toHaveBeenCalled();
    expect(nodeRepo.update).toHaveBeenCalledWith('node-1', expect.objectContaining({ lastSyncStatus: 'ERROR' }));
  });

  it('reporta "Coincide" (sin drift) cuando el estado del nodo coincide con Sumtech', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    accessRepo.find.mockResolvedValue([makeAccess({ connectionStatus: 'SUSPENDED' })]);
    clientFactory.mockReturnValue({
      testConnection: jest.fn().mockResolvedValue({ ok: true }),
      findPppSecretByName: jest.fn().mockResolvedValue({ name: 't1@tecmas', disabled: true }),
    });

    const summary = await service.checkNode('node-1');

    expect(summary.connectionOk).toBe(true);
    expect(summary.rows[0].drift).toBe(false);
    expect(summary.rows[0].detail).toBe('Coincide.');
    expect(auditRepo.save).toHaveBeenCalledWith(expect.objectContaining({ action: 'SHADOW_CHECK', result: 'OK' }));
    expect(nodeRepo.update).toHaveBeenCalledWith('node-1', expect.objectContaining({ lastSyncStatus: 'OK' }));
    // Un match limpia cualquier lastSyncError viejo del acceso — no solo queda en el log de auditoría.
    expect(accessRepo.update).toHaveBeenCalledWith('access-1', expect.objectContaining({ lastSyncError: null }));
  });

  it('reporta drift cuando Sumtech dice SUSPENDED pero el nodo tiene el secreto habilitado', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    accessRepo.find.mockResolvedValue([makeAccess({ connectionStatus: 'SUSPENDED' })]);
    clientFactory.mockReturnValue({
      testConnection: jest.fn().mockResolvedValue({ ok: true }),
      findPppSecretByName: jest.fn().mockResolvedValue({ name: 't1@tecmas', disabled: false }),
    });

    const summary = await service.checkNode('node-1');

    expect(summary.rows[0].drift).toBe(true);
    expect(summary.rows[0].detail).toContain('SUSPENDED');
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SHADOW_CHECK', result: 'ERROR', errorMessage: expect.stringContaining('SUSPENDED') }),
    );
    // El drift también se refleja en el propio acceso, no solo en el log —
    // así el badge de red del cliente lo puede mostrar sin ir a leer el log.
    expect(accessRepo.update).toHaveBeenCalledWith(
      'access-1',
      expect.objectContaining({ lastSyncError: expect.stringContaining('SUSPENDED') }),
    );
  });

  it('reporta drift cuando Sumtech tiene un usuario configurado que no existe en el nodo', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    accessRepo.find.mockResolvedValue([makeAccess()]);
    clientFactory.mockReturnValue({
      testConnection: jest.fn().mockResolvedValue({ ok: true }),
      findPppSecretByName: jest.fn().mockResolvedValue(null),
    });

    const summary = await service.checkNode('node-1');

    expect(summary.rows[0].drift).toBe(true);
    expect(summary.rows[0].routerFound).toBe(false);
    expect(summary.rows[0].detail).toContain('no existe ningún secreto PPP');
  });

  it('no compara nada contra el nodo (y no marca drift) cuando el acceso no tiene usuario configurado todavía', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    accessRepo.find.mockResolvedValue([makeAccess({ username: undefined, connectionStatus: 'PENDING' })]);
    const findPppSecretByName = jest.fn();
    clientFactory.mockReturnValue({ testConnection: jest.fn().mockResolvedValue({ ok: true }), findPppSecretByName });

    const summary = await service.checkNode('node-1');

    expect(findPppSecretByName).not.toHaveBeenCalled();
    expect(summary.rows[0].drift).toBe(false);
    expect(auditRepo.save).not.toHaveBeenCalled();
  });

  it('reporta drift (sin lanzar) si la consulta de un acceso puntual falla', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    accessRepo.find.mockResolvedValue([makeAccess()]);
    clientFactory.mockReturnValue({
      testConnection: jest.fn().mockResolvedValue({ ok: true }),
      findPppSecretByName: jest.fn().mockRejectedValue(new Error('401 no autorizado')),
    });

    const summary = await service.checkNode('node-1');

    expect(summary.rows[0].drift).toBe(true);
    expect(summary.rows[0].detail).toContain('401 no autorizado');
  });

  it('compara varios accesos del mismo nodo de forma independiente', async () => {
    nodeRepo.findOneBy.mockResolvedValue(makeNode());
    accessRepo.find.mockResolvedValue([
      makeAccess({ id: 'access-1', username: 't1@tecmas', connectionStatus: 'SUSPENDED' }),
      makeAccess({ id: 'access-2', username: 't2@tecmas', connectionStatus: 'ACTIVE' }),
    ]);
    clientFactory.mockReturnValue({
      testConnection: jest.fn().mockResolvedValue({ ok: true }),
      findPppSecretByName: jest
        .fn()
        .mockImplementation((name: string) => Promise.resolve(name === 't1@tecmas' ? { name, disabled: true } : { name, disabled: false })),
    });

    const summary = await service.checkNode('node-1');

    expect(summary.rows).toHaveLength(2);
    expect(summary.rows.every((r) => !r.drift)).toBe(true);
  });
});
