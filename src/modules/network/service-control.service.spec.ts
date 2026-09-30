import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ServiceControlService, NET_DEVICE_OFFLINE_CODE } from './service-control.service';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { ProvisioningAuditLogEntity } from './entities/provisioning-audit-log.entity';
import { NetworkProvisioningPortRegistry } from './network-provisioning-port.registry';
import { ROUTEROS_CLIENT_FACTORY } from './routeros/routeros-client-factory';
import { OltManagementService } from '../olt/services/olt-management.service';
import { NETWORK_OPS_QUEUE, NETWORK_OPS_JOBS } from './network-ops.constants';

describe('ServiceControlService', () => {
  let service: ServiceControlService;
  let accessRepo: any;
  let nodeRepo: any;
  let auditRepo: any;
  let portRegistry: any;
  let clientFactory: any;
  let oltService: any;
  let queue: any;
  let mockPort: any;

  beforeEach(async () => {
    process.env.ROUTEROS_CREDENTIALS = JSON.stringify({
      'MK-Toros': { username: 'admin', password: 'secretpassword' },
    });

    accessRepo = {
      findOne: jest.fn(),
      save: jest.fn((entity) => Promise.resolve({ ...entity })),
      createQueryBuilder: jest.fn(),
    };

    nodeRepo = {
      findOne: jest.fn(),
    };

    auditRepo = {
      create: jest.fn((dto) => ({ id: 'audit-1', ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    mockPort = {
      suspend: jest.fn().mockResolvedValue({ ok: true }),
      restore: jest.fn().mockResolvedValue({ ok: true }),
    };

    portRegistry = {
      resolveSuspensionMedium: jest.fn().mockReturnValue('PPPOE'),
      resolveForAccess: jest.fn().mockReturnValue(mockPort),
    };

    clientFactory = jest.fn().mockReturnValue({
      testConnection: jest.fn().mockResolvedValue({ ok: true }),
      findPppSecretByName: jest.fn().mockResolvedValue({ name: 'user1', disabled: true }),
    });

    oltService = {
      testConnection: jest.fn().mockResolvedValue({ ok: true }),
    };

    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceControlService,
        { provide: getRepositoryToken(NetworkAccessEntity), useValue: accessRepo },
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: getRepositoryToken(ProvisioningAuditLogEntity), useValue: auditRepo },
        { provide: NetworkProvisioningPortRegistry, useValue: portRegistry },
        { provide: ROUTEROS_CLIENT_FACTORY, useValue: clientFactory },
        { provide: OltManagementService, useValue: oltService },
        { provide: getQueueToken(NETWORK_OPS_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get<ServiceControlService>(ServiceControlService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('suspendService', () => {
    it('retorna applied: true si el contrato no tiene acceso de red registrado (servicio sin equipo)', async () => {
      accessRepo.findOne.mockResolvedValueOnce(null);

      const result = await service.suspendService('contract-none', { process: 'MANUAL', userId: 'user-1' });

      expect(result.applied).toBe(true);
      expect(result.medium).toBe('NONE');
    });

    it('ejecuta suspensión directa cuando el medio es NONE (modo manual)', async () => {
      const mockAccess = { id: 'acc-1', contractId: 'ctr-1', connectionStatus: 'ACTIVE' };
      accessRepo.findOne.mockResolvedValueOnce(mockAccess);
      portRegistry.resolveSuspensionMedium.mockReturnValueOnce('NONE');

      const result = await service.suspendService('ctr-1', { process: 'MANUAL', userId: 'user-1' });

      expect(result.applied).toBe(true);
      expect(result.medium).toBe('NONE');
      expect(accessRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ connectionStatus: 'SUSPENDED', pendingOperation: null }),
      );
    });

    it('lanza ConflictException 409 con NET_DEVICE_OFFLINE si el router está offline en operación MANUAL', async () => {
      const mockAccess = {
        id: 'acc-1',
        contractId: 'ctr-1',
        node: { id: 'node-1', name: 'MK-Toros', managementIp: '10.0.0.1', apiPort: 443, useHttps: true },
        username: 'user1',
      };
      accessRepo.findOne.mockResolvedValueOnce(mockAccess);
      portRegistry.resolveSuspensionMedium.mockReturnValueOnce('PPPOE');

      // Simular router caído
      clientFactory.mockReturnValueOnce({
        testConnection: jest.fn().mockResolvedValue({ ok: false, error: 'Connection refused' }),
      });

      await expect(
        service.suspendService('ctr-1', { process: 'MANUAL', userId: 'admin-1', reason: 'Falta de pago' }),
      ).rejects.toThrow(ConflictException);

      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'ERROR', errorCode: NET_DEVICE_OFFLINE_CODE }),
      );
    });

    it('encola la operación en BullMQ con pendingOperation=SUSPEND si el router está offline en CRON_MOROSIDAD', async () => {
      const mockAccess = {
        id: 'acc-1',
        contractId: 'ctr-1',
        node: { id: 'node-1', name: 'MK-Toros', managementIp: '10.0.0.1', apiPort: 443, useHttps: true },
        username: 'user1',
        pendingAttempts: 0,
      };
      accessRepo.findOne.mockResolvedValueOnce(mockAccess);
      portRegistry.resolveSuspensionMedium.mockReturnValueOnce('PPPOE');

      clientFactory.mockReturnValueOnce({
        testConnection: jest.fn().mockResolvedValue({ ok: false, error: 'Connection timeout' }),
      });

      const result = await service.suspendService('ctr-1', { process: 'CRON_MOROSIDAD', reason: 'Facturas vencidas' });

      expect(result.applied).toBe(false);
      expect(result.errorCode).toBe(NET_DEVICE_OFFLINE_CODE);
      expect(accessRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingOperation: 'SUSPEND',
          pendingAttempts: 1,
          lastErrorCode: NET_DEVICE_OFFLINE_CODE,
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        NETWORK_OPS_JOBS.RETRY_PENDING_OPERATION,
        expect.objectContaining({ accessId: 'acc-1', contractId: 'ctr-1', operation: 'SUSPEND' }),
        expect.any(Object),
      );
    });

    it('aplica suspensión, verifica en router y audita exitosamente cuando el router está online', async () => {
      const mockAccess = {
        id: 'acc-1',
        contractId: 'ctr-1',
        node: { id: 'node-1', name: 'MK-Toros', managementIp: '10.0.0.1', apiPort: 443, useHttps: true },
        username: 'user1',
      };
      accessRepo.findOne.mockResolvedValueOnce(mockAccess);
      portRegistry.resolveSuspensionMedium.mockReturnValueOnce('PPPOE');

      const result = await service.suspendService('ctr-1', { process: 'MANUAL', userId: 'user-1' });

      expect(mockPort.suspend).toHaveBeenCalledWith(mockAccess);
      expect(result.applied).toBe(true);
      expect(result.verified).toBe(true);
      expect(accessRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ connectionStatus: 'SUSPENDED', pendingOperation: null }),
      );
      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SUSPEND', result: 'OK', actor: 'USER:user-1' }),
      );
    });
  });

  describe('restoreService', () => {
    it('aplica reactivación en el equipo, confirma secret habilitado y limpia pendientes', async () => {
      const mockAccess = {
        id: 'acc-1',
        contractId: 'ctr-1',
        node: { id: 'node-1', name: 'MK-Toros', managementIp: '10.0.0.1', apiPort: 443, useHttps: true },
        username: 'user1',
        pendingOperation: 'RESTORE',
      };
      accessRepo.findOne.mockResolvedValueOnce(mockAccess);
      portRegistry.resolveSuspensionMedium.mockReturnValueOnce('PPPOE');

      clientFactory.mockReturnValue({
        testConnection: jest.fn().mockResolvedValue({ ok: true }),
        findPppSecretByName: jest.fn().mockResolvedValue({ name: 'user1', disabled: false }),
      });

      const result = await service.restoreService('ctr-1', { process: 'PAGO', reason: 'Pago liquidado' });

      expect(mockPort.restore).toHaveBeenCalledWith(mockAccess);
      expect(result.applied).toBe(true);
      expect(result.verified).toBe(true);
      expect(accessRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ connectionStatus: 'ACTIVE', pendingOperation: null }),
      );
    });
  });

  describe('applyPending', () => {
    it('ejecuta reintento exitoso y limpia pendingOperation cuando el equipo vuelve a estar online', async () => {
      const mockAccess = {
        id: 'acc-1',
        contractId: 'ctr-1',
        pendingOperation: 'SUSPEND',
        pendingAttempts: 1,
        node: { id: 'node-1', name: 'MK-Toros', managementIp: '10.0.0.1', apiPort: 443, useHttps: true },
        username: 'user1',
      };
      accessRepo.findOne.mockResolvedValueOnce(mockAccess);
      portRegistry.resolveSuspensionMedium.mockReturnValueOnce('PPPOE');

      const result = await service.applyPending('acc-1');

      expect(result.applied).toBe(true);
      expect(accessRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ pendingOperation: null, connectionStatus: 'SUSPENDED' }),
      );
    });
  });
});
