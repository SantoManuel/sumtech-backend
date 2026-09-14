import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { NetworkProvisioningService } from './network-provisioning.service';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { ProvisioningAuditLogEntity } from './entities/provisioning-audit-log.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { NetworkProvisioningPortRegistry } from './network-provisioning-port.registry';

describe('NetworkProvisioningService', () => {
  let service: NetworkProvisioningService;
  let accessRepo: any;
  let nodeRepo: any;
  let auditRepo: any;
  let auditQueryBuilder: any;
  let contractRepo: any;
  let port: any;

  const makeAccess = (overrides: Partial<NetworkAccessEntity> = {}): NetworkAccessEntity =>
    ({
      id: 'access-1',
      contractId: 'contract-1',
      nodeId: undefined,
      username: undefined,
      serviceAlias: undefined,
      ipAddress: undefined,
      connectionStatus: 'PENDING',
      provisioningSource: 'MANUAL',
      lastSyncAt: undefined,
      lastSyncError: undefined,
      ...overrides,
    }) as NetworkAccessEntity;

  beforeEach(async () => {
    accessRepo = {
      findOneBy: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: entity.id || 'access-generated', ...entity })),
    };
    nodeRepo = { findOneBy: jest.fn() };
    auditQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    auditRepo = {
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
      createQueryBuilder: jest.fn().mockReturnValue(auditQueryBuilder),
    };
    contractRepo = { findOneBy: jest.fn(), findOne: jest.fn() };
    port = {
      provision: jest.fn().mockResolvedValue({ ok: true }),
      suspend: jest.fn().mockResolvedValue({ ok: true }),
      restore: jest.fn().mockResolvedValue({ ok: true }),
      deprovision: jest.fn().mockResolvedValue({ ok: true }),
      syncProfile: jest.fn().mockResolvedValue({ ok: true }),
    };
    // El registro elige el adaptador por nodo (Fase 06); estas pruebas no
    // ejercitan esa selección en sí (ver network-provisioning-port.registry.spec.ts),
    // así que devuelve el mismo `port` sin importar el modo pedido.
    const portRegistry = { resolve: jest.fn().mockReturnValue(port) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NetworkProvisioningService,
        { provide: getRepositoryToken(NetworkAccessEntity), useValue: accessRepo },
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: getRepositoryToken(ProvisioningAuditLogEntity), useValue: auditRepo },
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: NetworkProvisioningPortRegistry, useValue: portRegistry },
      ],
    }).compile();

    service = module.get<NetworkProvisioningService>(NetworkProvisioningService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('createAccessForContract', () => {
    it('crea el acceso en PENDING y registra auditoría CREATE cuando no existía', async () => {
      accessRepo.findOneBy.mockResolvedValue(null);

      const result = await service.createAccessForContract('contract-1');

      expect(result.connectionStatus).toBe('PENDING');
      expect(result.provisioningSource).toBe('MANUAL');
      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ contractId: 'contract-1', action: 'CREATE', result: 'OK' }),
      );
    });

    it('es idempotente: si ya existe un acceso para el contrato, lo devuelve sin duplicar ni auditar', async () => {
      accessRepo.findOneBy.mockResolvedValue(makeAccess());

      const result = await service.createAccessForContract('contract-1');

      expect(result.id).toBe('access-1');
      expect(accessRepo.save).not.toHaveBeenCalled();
      expect(auditRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('upsertConfiguration', () => {
    it('lanza NotFoundException si el contrato no pertenece al cliente', async () => {
      contractRepo.findOneBy.mockResolvedValue(null);

      await expect(service.upsertConfiguration('client-1', 'contract-1', { username: 't1' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza NotFoundException si se referencia un nodo inexistente', async () => {
      contractRepo.findOneBy.mockResolvedValue({ id: 'contract-1', clientId: 'client-1' });
      nodeRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.upsertConfiguration('client-1', 'contract-1', { nodeId: 'node-x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('aprovisiona (PROVISION + ACTIVE) cuando, tras aplicar los cambios, el acceso PENDING queda con nodo y usuario', async () => {
      contractRepo.findOneBy.mockResolvedValue({ id: 'contract-1', clientId: 'client-1' });
      nodeRepo.findOneBy.mockResolvedValue({ id: 'node-1', name: 'RB Las Yayas' });
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'PENDING' }));
      accessRepo.findOne.mockResolvedValue(makeAccess({ connectionStatus: 'ACTIVE', nodeId: 'node-1', username: 't1' }));

      const result = await service.upsertConfiguration('client-1', 'contract-1', {
        nodeId: 'node-1',
        username: 't1',
      });

      expect(port.provision).toHaveBeenCalledTimes(1);
      expect(result.connectionStatus).toBe('ACTIVE');
      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PROVISION', result: 'OK' }),
      );
    });

    it('no aprovisiona si solo se configura el nodo sin usuario (sigue PENDING)', async () => {
      contractRepo.findOneBy.mockResolvedValue({ id: 'contract-1', clientId: 'client-1' });
      nodeRepo.findOneBy.mockResolvedValue({ id: 'node-1' });
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'PENDING' }));
      accessRepo.findOne.mockResolvedValue(makeAccess({ connectionStatus: 'PENDING', nodeId: 'node-1' }));

      await service.upsertConfiguration('client-1', 'contract-1', { nodeId: 'node-1' });

      expect(port.provision).not.toHaveBeenCalled();
    });

    it('no vuelve a aprovisionar un acceso que ya estaba ACTIVE (solo actualiza los campos provistos)', async () => {
      contractRepo.findOneBy.mockResolvedValue({ id: 'contract-1', clientId: 'client-1' });
      accessRepo.findOneBy.mockResolvedValue(
        makeAccess({ connectionStatus: 'ACTIVE', nodeId: 'node-1', username: 't1' }),
      );
      accessRepo.findOne.mockResolvedValue(
        makeAccess({ connectionStatus: 'ACTIVE', nodeId: 'node-1', username: 't1-renombrado' }),
      );

      const result = await service.upsertConfiguration('client-1', 'contract-1', { username: 't1-renombrado' });

      expect(port.provision).not.toHaveBeenCalled();
      expect(result.username).toBe('t1-renombrado');
    });

    it('crea el acceso sobre la marcha si el contrato todavía no tenía uno', async () => {
      contractRepo.findOneBy.mockResolvedValue({ id: 'contract-1', clientId: 'client-1' });
      nodeRepo.findOneBy.mockResolvedValue({ id: 'node-1' });
      accessRepo.findOneBy.mockResolvedValue(null);
      accessRepo.findOne.mockResolvedValue(makeAccess({ connectionStatus: 'ACTIVE', nodeId: 'node-1', username: 't1' }));

      await service.upsertConfiguration('client-1', 'contract-1', { nodeId: 'node-1', username: 't1' });

      expect(accessRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ contractId: 'contract-1', connectionStatus: 'PENDING' }),
      );
    });
  });

  describe('importLegacyAccess', () => {
    it('crea el acceso con el connectionStatus exacto del export y lo audita con actor IMPORT', async () => {
      accessRepo.findOneBy.mockResolvedValue(null);

      const result = await service.importLegacyAccess('contract-1', {
        nodeId: 'node-1',
        username: 't1@tecmas',
        serviceAlias: 't1',
        ipAddress: '192.168.60.100',
        connectionStatus: 'SUSPENDED',
      });

      expect(result.connectionStatus).toBe('SUSPENDED');
      expect(result.username).toBe('t1@tecmas');
      expect(port.provision).not.toHaveBeenCalled();
      expect(port.suspend).not.toHaveBeenCalled();
      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', result: 'OK', actor: 'IMPORT' }),
      );
    });

    it('es idempotente: correrlo dos veces sobre el mismo contrato actualiza la misma fila, no crea una segunda', async () => {
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'PENDING', username: 'viejo' }));

      const result = await service.importLegacyAccess('contract-1', {
        username: 'nuevo',
        connectionStatus: 'ACTIVE',
      });

      expect(result.username).toBe('nuevo');
      expect(result.connectionStatus).toBe('ACTIVE');
      expect(accessRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('suspend', () => {
    it('devuelve null y no falla si el contrato no tiene acceso de red', async () => {
      accessRepo.findOneBy.mockResolvedValue(null);

      const result = await service.suspend('contract-x');

      expect(result).toBeNull();
      expect(port.suspend).not.toHaveBeenCalled();
    });

    it('suspende un acceso ACTIVE y registra auditoría', async () => {
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'ACTIVE' }));

      const result = await service.suspend('contract-1');

      expect(port.suspend).toHaveBeenCalledTimes(1);
      expect(result!.connectionStatus).toBe('SUSPENDED');
      expect(auditRepo.save).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUSPEND', result: 'OK' }));
    });

    it('registra el motivo de negocio recibido en la auditoría (Fase 08)', async () => {
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'ACTIVE' }));

      await service.suspend('contract-1', 'Suspensión automática por morosidad: 15 día(s) de atraso.');

      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SUSPEND',
          reason: 'Suspensión automática por morosidad: 15 día(s) de atraso.',
        }),
      );
    });

    it('audita reason: undefined si no se recibió ningún motivo (ej. invocación directa sin contexto de negocio)', async () => {
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'ACTIVE' }));

      await service.suspend('contract-1');

      expect(auditRepo.save).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUSPEND', reason: undefined }));
    });

    it('es idempotente: un acceso ya SUSPENDED no vuelve a llamar al puerto', async () => {
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'SUSPENDED' }));

      await service.suspend('contract-1');

      expect(port.suspend).not.toHaveBeenCalled();
      expect(accessRepo.save).not.toHaveBeenCalled();
    });

    it('un acceso CUT no se reactiva por error hacia SUSPENDED', async () => {
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'CUT' }));

      const result = await service.suspend('contract-1');

      expect(result!.connectionStatus).toBe('CUT');
      expect(port.suspend).not.toHaveBeenCalled();
    });

    it('si el adaptador falla, conserva el estado anterior y registra el error de auditoría', async () => {
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'ACTIVE' }));
      port.suspend.mockResolvedValueOnce({ ok: false, error: 'timeout de RouterOS' });

      const result = await service.suspend('contract-1');

      expect(result!.connectionStatus).toBe('ACTIVE');
      expect(result!.lastSyncError).toBe('timeout de RouterOS');
      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SUSPEND', result: 'ERROR', errorMessage: 'timeout de RouterOS' }),
      );
    });
  });

  describe('restore', () => {
    it('devuelve null si el contrato no tiene acceso de red', async () => {
      accessRepo.findOneBy.mockResolvedValue(null);

      expect(await service.restore('contract-x')).toBeNull();
    });

    it('restaura un acceso SUSPENDED a ACTIVE', async () => {
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'SUSPENDED' }));

      const result = await service.restore('contract-1');

      expect(port.restore).toHaveBeenCalledTimes(1);
      expect(result!.connectionStatus).toBe('ACTIVE');
    });

    it('registra el motivo de negocio recibido en la auditoría (Fase 08)', async () => {
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'SUSPENDED' }));

      await service.restore('contract-1', 'Reactivación manual por administrador.');

      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESTORE', reason: 'Reactivación manual por administrador.' }),
      );
    });

    it('es idempotente: un acceso ya ACTIVE no vuelve a llamar al puerto', async () => {
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'ACTIVE' }));

      await service.restore('contract-1');

      expect(port.restore).not.toHaveBeenCalled();
    });
  });

  describe('deprovision', () => {
    it('devuelve null si el contrato no tiene acceso de red', async () => {
      accessRepo.findOneBy.mockResolvedValue(null);

      expect(await service.deprovision('contract-x')).toBeNull();
    });

    it('corta un acceso ACTIVE (pasa a CUT)', async () => {
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'ACTIVE' }));

      const result = await service.deprovision('contract-1');

      expect(port.deprovision).toHaveBeenCalledTimes(1);
      expect(result!.connectionStatus).toBe('CUT');
    });

    it('registra el motivo de negocio recibido en la auditoría (Fase 08)', async () => {
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'ACTIVE' }));

      await service.deprovision('contract-1', 'Terminación manual por administrador.');

      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPROVISION', reason: 'Terminación manual por administrador.' }),
      );
    });

    it('es idempotente: un acceso ya CUT no vuelve a llamar al puerto', async () => {
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'CUT' }));

      await service.deprovision('contract-1');

      expect(port.deprovision).not.toHaveBeenCalled();
    });
  });

  describe('syncProfileForContract', () => {
    it('devuelve null sin llamar al puerto si el contrato no existe', async () => {
      contractRepo.findOne.mockResolvedValue(null);

      const result = await service.syncProfileForContract('contract-x');

      expect(result).toBeNull();
      expect(port.syncProfile).not.toHaveBeenCalled();
    });

    it('devuelve null sin llamar al puerto si el contrato no tiene plan cargado', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', plan: null });

      const result = await service.syncProfileForContract('contract-1');

      expect(result).toBeNull();
      expect(port.syncProfile).not.toHaveBeenCalled();
    });

    it('devuelve null sin consultar el acceso si el plan no tiene velocidad (ej. solo TV, speedMbps=0)', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', plan: { speedMbps: 0 } });

      const result = await service.syncProfileForContract('contract-1');

      expect(result).toBeNull();
      expect(accessRepo.findOneBy).not.toHaveBeenCalled();
      expect(port.syncProfile).not.toHaveBeenCalled();
    });

    it('devuelve null si el contrato todavía no tiene ningún acceso de red', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', plan: { speedMbps: 50 } });
      accessRepo.findOneBy.mockResolvedValue(null);

      const result = await service.syncProfileForContract('contract-1');

      expect(result).toBeNull();
      expect(port.syncProfile).not.toHaveBeenCalled();
    });

    it('devuelve el acceso sin llamar al puerto si todavía no tiene nodo/usuario configurados', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', plan: { speedMbps: 50 } });
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ nodeId: undefined, username: undefined }));

      const result = await service.syncProfileForContract('contract-1');

      expect(result).not.toBeNull();
      expect(port.syncProfile).not.toHaveBeenCalled();
    });

    it('llama a port.syncProfile con el nombre y la velocidad del plan, y registra auditoría SYNC_PROFILE OK', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', plan: { speedMbps: 50 } });
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ nodeId: 'node-1', username: 't1@tecmas' }));

      const result = await service.syncProfileForContract('contract-1');

      expect(port.syncProfile).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'node-1', username: 't1@tecmas' }),
        { name: 'Sumtech-50Mbps', rateLimitMbps: 50 },
      );
      expect(result!.lastSyncError).toBeNull();
      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SYNC_PROFILE', result: 'OK' }),
      );
    });

    it('si el adaptador falla, registra el error en el acceso y en la auditoría', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', plan: { speedMbps: 50 } });
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ nodeId: 'node-1', username: 't1@tecmas' }));
      port.syncProfile.mockResolvedValueOnce({ ok: false, error: 'perfil no encontrado' });

      const result = await service.syncProfileForContract('contract-1');

      expect(result!.lastSyncError).toBe('perfil no encontrado');
      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SYNC_PROFILE', result: 'ERROR', errorMessage: 'perfil no encontrado' }),
      );
    });
  });

  describe('upsertConfiguration → sincronización de perfil', () => {
    it('llama a syncProfileForContract (y por lo tanto a port.syncProfile) tras aprovisionar', async () => {
      contractRepo.findOneBy.mockResolvedValue({ id: 'contract-1', clientId: 'client-1' });
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', plan: { speedMbps: 100 } });
      nodeRepo.findOneBy.mockResolvedValue({ id: 'node-1', name: 'RB Las Yayas' });
      accessRepo.findOneBy.mockResolvedValue(makeAccess({ connectionStatus: 'PENDING' }));
      accessRepo.findOne.mockResolvedValue(makeAccess({ connectionStatus: 'ACTIVE', nodeId: 'node-1', username: 't1' }));

      await service.upsertConfiguration('client-1', 'contract-1', { nodeId: 'node-1', username: 't1' });

      expect(port.syncProfile).toHaveBeenCalledWith(expect.anything(), { name: 'Sumtech-100Mbps', rateLimitMbps: 100 });
    });
  });

  describe('findAuditLog', () => {
    const makeAuditEntry = (overrides: any = {}) => ({
      id: 'audit-1',
      contractId: 'contract-1',
      action: 'SUSPEND',
      result: 'OK',
      errorMessage: undefined,
      reason: 'Suspensión automática por morosidad: 6 día(s) de atraso.',
      actor: 'SYSTEM',
      createdAt: new Date('2026-09-01T12:00:00Z'),
      access: {
        nodeId: 'node-1',
        contract: {
          contractNumber: 'CTR-0001',
          client: { id: 'client-1', name: 'Moises Perez' },
        },
        node: { id: 'node-1', name: 'RB Las Yayas' },
      },
      ...overrides,
    });

    it('aplica paginación por defecto (page 1, limit 10) y arma el query con los joins esperados', async () => {
      auditQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAuditLog({});

      expect(auditRepo.createQueryBuilder).toHaveBeenCalledWith('audit');
      expect(auditQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('audit.access', 'access');
      expect(auditQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('access.contract', 'contract');
      expect(auditQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('contract.client', 'client');
      expect(auditQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('access.node', 'node');
      expect(auditQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(auditQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
    });

    it('aplica los filtros recibidos (contractId, nodeId, action, result) como andWhere', async () => {
      auditQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAuditLog({ contractId: 'contract-1', nodeId: 'node-1', action: 'SUSPEND', result: 'ERROR' });

      expect(auditQueryBuilder.andWhere).toHaveBeenCalledWith('audit.contractId = :contractId', {
        contractId: 'contract-1',
      });
      expect(auditQueryBuilder.andWhere).toHaveBeenCalledWith('access.nodeId = :nodeId', { nodeId: 'node-1' });
      expect(auditQueryBuilder.andWhere).toHaveBeenCalledWith('audit.action = :action', { action: 'SUSPEND' });
      expect(auditQueryBuilder.andWhere).toHaveBeenCalledWith('audit.result = :result', { result: 'ERROR' });
    });

    it('no aplica ningún andWhere si no se recibió ningún filtro', async () => {
      auditQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findAuditLog({});

      expect(auditQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('respeta page/limit recibidos para el cálculo de skip y totalPages', async () => {
      auditQueryBuilder.getManyAndCount.mockResolvedValue([[makeAuditEntry()], 25]);

      const result = await service.findAuditLog({ page: 3, limit: 5 });

      expect(auditQueryBuilder.skip).toHaveBeenCalledWith(10);
      expect(auditQueryBuilder.take).toHaveBeenCalledWith(5);
      expect(result.page).toBe(3);
      expect(result.limit).toBe(5);
      expect(result.totalPages).toBe(5);
    });

    it('mapea cada entrada con los nombres legibles de contrato/cliente/nodo, no solo los IDs', async () => {
      auditQueryBuilder.getManyAndCount.mockResolvedValue([[makeAuditEntry()], 1]);

      const result = await service.findAuditLog({});

      expect(result.data).toEqual([
        {
          id: 'audit-1',
          contractId: 'contract-1',
          contractNumber: 'CTR-0001',
          clientId: 'client-1',
          clientName: 'Moises Perez',
          nodeId: 'node-1',
          nodeName: 'RB Las Yayas',
          action: 'SUSPEND',
          result: 'OK',
          errorMessage: undefined,
          reason: 'Suspensión automática por morosidad: 6 día(s) de atraso.',
          actor: 'SYSTEM',
          createdAt: new Date('2026-09-01T12:00:00Z'),
        },
      ]);
    });

    it('no falla si el acceso no tiene nodo asignado (nodeId/nodeName quedan undefined)', async () => {
      auditQueryBuilder.getManyAndCount.mockResolvedValue([
        [
          makeAuditEntry({
            access: { nodeId: undefined, contract: { contractNumber: 'CTR-0002', client: { id: 'c2', name: 'Ana' } }, node: undefined },
          }),
        ],
        1,
      ]);

      const result = await service.findAuditLog({});

      expect(result.data[0].nodeId).toBeUndefined();
      expect(result.data[0].nodeName).toBeUndefined();
      expect(result.data[0].clientName).toBe('Ana');
    });
  });
});
