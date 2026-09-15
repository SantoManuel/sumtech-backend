import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadGatewayException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { GenieAcsMonitoringService } from './genieacs-monitoring.service';
import { GenieAcsDeviceEntity } from './entities/genieacs-device.entity';
import { GenieAcsAuditLogEntity } from './entities/genieacs-audit-log.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { GenieAcsDeviceResolverService } from './genieacs-device-resolver.service';
import { GENIEACS_CLIENT } from './genieacs-client-factory';

describe('GenieAcsMonitoringService', () => {
  let service: GenieAcsMonitoringService;
  let deviceRepo: any;
  let auditRepo: any;
  let contractRepo: any;
  let resolver: any;
  let client: any;

  const makeDevice = (overrides: Partial<GenieAcsDeviceEntity> = {}): GenieAcsDeviceEntity =>
    ({
      id: 'device-1',
      contractId: 'contract-1',
      genieacsDeviceId: '00259E-ONT-16',
      ssid: 'Sumtech_100M_OLD',
      lastRebootAt: undefined,
      lastSyncError: undefined,
      ...overrides,
    }) as GenieAcsDeviceEntity;

  beforeEach(async () => {
    deviceRepo = { save: jest.fn((entity: any) => Promise.resolve(entity)) };
    auditRepo = { create: jest.fn((dto: any) => dto), save: jest.fn((entity: any) => Promise.resolve(entity)) };
    contractRepo = { findOneBy: jest.fn().mockResolvedValue({ id: 'contract-1' }) };
    resolver = { resolveForContract: jest.fn() };
    client = { getDeviceStatus: jest.fn(), rebootDevice: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenieAcsMonitoringService,
        { provide: getRepositoryToken(GenieAcsDeviceEntity), useValue: deviceRepo },
        { provide: getRepositoryToken(GenieAcsAuditLogEntity), useValue: auditRepo },
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: GenieAcsDeviceResolverService, useValue: resolver },
        { provide: GENIEACS_CLIENT, useValue: client },
      ],
    }).compile();

    service = module.get<GenieAcsMonitoringService>(GenieAcsMonitoringService);
  });

  describe('getLiveStatus', () => {
    it('lanza NotFoundException si el contrato no existe', async () => {
      contractRepo.findOneBy.mockResolvedValue(null);

      await expect(service.getLiveStatus('contract-x')).rejects.toThrow(NotFoundException);
      expect(resolver.resolveForContract).not.toHaveBeenCalled();
    });

    it('devuelve linked:false si el contrato no tiene equipo vinculado', async () => {
      resolver.resolveForContract.mockResolvedValue(null);

      const result = await service.getLiveStatus('contract-1');

      expect(result).toEqual({ linked: false, lastSyncError: undefined });
    });

    it('devuelve onlineStatus ONLINE con datos recientes', async () => {
      resolver.resolveForContract.mockResolvedValue(makeDevice());
      client.getDeviceStatus.mockResolvedValue({
        isTR181: false,
        ssid: 'MiRed',
        opticalRxPowerDbm: -18,
        lastInformAt: new Date(),
      });

      const result = await service.getLiveStatus('contract-1');

      expect(result.linked).toBe(true);
      expect(result.onlineStatus).toBe('ONLINE');
      expect(result.alertLowOpticalPower).toBe(false);
    });

    it('marca alertLowOpticalPower cuando la potencia óptica está por debajo del umbral', async () => {
      resolver.resolveForContract.mockResolvedValue(makeDevice());
      client.getDeviceStatus.mockResolvedValue({ isTR181: false, opticalRxPowerDbm: -30, lastInformAt: new Date() });

      const result = await service.getLiveStatus('contract-1');

      expect(result.alertLowOpticalPower).toBe(true);
    });

    it('devuelve onlineStatus OFFLINE si el último Inform fue hace horas', async () => {
      resolver.resolveForContract.mockResolvedValue(makeDevice());
      client.getDeviceStatus.mockResolvedValue({
        isTR181: false,
        lastInformAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
      });

      const result = await service.getLiveStatus('contract-1');

      expect(result.onlineStatus).toBe('OFFLINE');
    });

    it('si GenieACS no está configurado, devuelve UNKNOWN sin llamar a la NBI', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GenieAcsMonitoringService,
          { provide: getRepositoryToken(GenieAcsDeviceEntity), useValue: deviceRepo },
          { provide: getRepositoryToken(GenieAcsAuditLogEntity), useValue: auditRepo },
          { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
          { provide: GenieAcsDeviceResolverService, useValue: resolver },
          { provide: GENIEACS_CLIENT, useValue: null },
        ],
      }).compile();
      const unconfigured = module.get<GenieAcsMonitoringService>(GenieAcsMonitoringService);
      resolver.resolveForContract.mockResolvedValue(makeDevice());

      const result = await unconfigured.getLiveStatus('contract-1');

      expect(result).toEqual(
        expect.objectContaining({ linked: true, onlineStatus: 'UNKNOWN' }),
      );
      expect(client.getDeviceStatus).not.toHaveBeenCalled();
    });

    it('si la NBI falla, devuelve UNKNOWN con el error y no revienta', async () => {
      resolver.resolveForContract.mockResolvedValue(makeDevice());
      client.getDeviceStatus.mockRejectedValue(new Error('timeout de GenieACS'));

      const result = await service.getLiveStatus('contract-1');

      expect(result.onlineStatus).toBe('UNKNOWN');
      expect(result.lastSyncError).toBe('timeout de GenieACS');
    });
  });

  describe('rebootDevice', () => {
    it('lanza NotFoundException si el contrato no existe', async () => {
      contractRepo.findOneBy.mockResolvedValue(null);

      await expect(service.rebootDevice('contract-x', 'admin-1')).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si el contrato no tiene equipo vinculado', async () => {
      resolver.resolveForContract.mockResolvedValue(null);

      await expect(service.rebootDevice('contract-1', 'admin-1')).rejects.toThrow(NotFoundException);
      expect(client.rebootDevice).not.toHaveBeenCalled();
    });

    it('lanza ServiceUnavailableException si GenieACS no está configurado', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GenieAcsMonitoringService,
          { provide: getRepositoryToken(GenieAcsDeviceEntity), useValue: deviceRepo },
          { provide: getRepositoryToken(GenieAcsAuditLogEntity), useValue: auditRepo },
          { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
          { provide: GenieAcsDeviceResolverService, useValue: resolver },
          { provide: GENIEACS_CLIENT, useValue: null },
        ],
      }).compile();
      const unconfigured = module.get<GenieAcsMonitoringService>(GenieAcsMonitoringService);
      resolver.resolveForContract.mockResolvedValue(makeDevice());

      await expect(unconfigured.rebootDevice('contract-1', 'admin-1')).rejects.toThrow(ServiceUnavailableException);
    });

    it('reinicia el equipo, actualiza lastRebootAt y audita con el actor recibido', async () => {
      resolver.resolveForContract.mockResolvedValue(makeDevice());
      client.rebootDevice.mockResolvedValue(undefined);

      await service.rebootDevice('contract-1', 'admin-1');

      expect(client.rebootDevice).toHaveBeenCalledWith('00259E-ONT-16');
      expect(deviceRepo.save).toHaveBeenCalledWith(expect.objectContaining({ lastRebootAt: expect.any(Date) }));
      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REBOOT', actor: 'admin-1', result: 'OK' }),
      );
    });

    it('si el reinicio falla, audita ERROR y lanza BadGatewayException', async () => {
      resolver.resolveForContract.mockResolvedValue(makeDevice());
      client.rebootDevice.mockRejectedValue(new Error('GenieACS respondió con error 500'));

      await expect(service.rebootDevice('contract-1', 'admin-1')).rejects.toThrow(BadGatewayException);

      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REBOOT', result: 'ERROR', errorMessage: 'GenieACS respondió con error 500' }),
      );
    });
  });
});
