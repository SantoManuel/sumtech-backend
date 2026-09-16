import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException, ServiceUnavailableException, BadGatewayException } from '@nestjs/common';
import { GenieAcsWifiService } from './genieacs-wifi.service';
import { GenieAcsDeviceEntity } from './entities/genieacs-device.entity';
import { GenieAcsAuditLogEntity } from './entities/genieacs-audit-log.entity';
import { GenieAcsDeviceResolverService } from './genieacs-device-resolver.service';
import { GENIEACS_CLIENT } from './genieacs-client-factory';

describe('GenieAcsWifiService', () => {
  let service: GenieAcsWifiService;
  let deviceRepo: any;
  let auditRepo: any;
  let resolver: any;
  let client: any;

  const makeDevice = (overrides: Partial<GenieAcsDeviceEntity> = {}): GenieAcsDeviceEntity =>
    ({
      id: 'device-1',
      contractId: 'contract-1',
      genieacsDeviceId: '00259E-ONT-16',
      ssid: 'Sumtech_100M_OLD',
      ssid5g: undefined,
      lastWifiChangeAt: undefined,
      lastSyncError: undefined,
      ...overrides,
    }) as GenieAcsDeviceEntity;

  const credentials = { ssid: 'MiCasaWifi', password: 'ClaveSuperSegura123' };

  beforeEach(async () => {
    deviceRepo = { save: jest.fn((entity: any) => Promise.resolve(entity)) };
    auditRepo = { create: jest.fn((dto: any) => dto), save: jest.fn((entity: any) => Promise.resolve(entity)) };
    resolver = { resolveForContract: jest.fn() };
    client = {
      getDeviceStatus: jest.fn().mockResolvedValue({ isTR181: false }),
      setWifiCredentials: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenieAcsWifiService,
        { provide: getRepositoryToken(GenieAcsDeviceEntity), useValue: deviceRepo },
        { provide: getRepositoryToken(GenieAcsAuditLogEntity), useValue: auditRepo },
        { provide: GenieAcsDeviceResolverService, useValue: resolver },
        { provide: GENIEACS_CLIENT, useValue: client },
      ],
    }).compile();

    service = module.get<GenieAcsWifiService>(GenieAcsWifiService);
  });

  describe('getWifiStatus', () => {
    it('devuelve linked:false si el contrato no tiene ningún equipo vinculado', async () => {
      resolver.resolveForContract.mockResolvedValue(null);

      const status = await service.getWifiStatus('contract-1');

      expect(status).toEqual({ linked: false, lastSyncError: undefined });
    });

    it('devuelve el SSID cacheado si ya está vinculado', async () => {
      resolver.resolveForContract.mockResolvedValue(makeDevice({ ssid: 'MiRed', ssid5g: 'MiRed_5G' }));

      const status = await service.getWifiStatus('contract-1');

      expect(status).toEqual({ linked: true, ssid: 'MiRed', ssid5g: 'MiRed_5G', lastSyncError: undefined });
    });
  });

  describe('changeWifiCredentials', () => {
    it('lanza NotFoundException si el contrato no tiene equipo vinculado todavía', async () => {
      resolver.resolveForContract.mockResolvedValue(null);

      await expect(service.changeWifiCredentials('contract-1', credentials)).rejects.toThrow(NotFoundException);
      expect(client.setWifiCredentials).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si hay registro pero sin genieacsDeviceId resuelto', async () => {
      resolver.resolveForContract.mockResolvedValue(makeDevice({ genieacsDeviceId: undefined }));

      await expect(service.changeWifiCredentials('contract-1', credentials)).rejects.toThrow(NotFoundException);
    });

    it('lanza ServiceUnavailableException si GenieACS no está configurado', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GenieAcsWifiService,
          { provide: getRepositoryToken(GenieAcsDeviceEntity), useValue: deviceRepo },
          { provide: getRepositoryToken(GenieAcsAuditLogEntity), useValue: auditRepo },
          { provide: GenieAcsDeviceResolverService, useValue: resolver },
          { provide: GENIEACS_CLIENT, useValue: null },
        ],
      }).compile();
      const unconfiguredService = module.get<GenieAcsWifiService>(GenieAcsWifiService);
      resolver.resolveForContract.mockResolvedValue(makeDevice());

      await expect(unconfiguredService.changeWifiCredentials('contract-1', credentials)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('lanza ConflictException (rate limit) si el último cambio fue hace menos de 10 minutos', async () => {
      resolver.resolveForContract.mockResolvedValue(
        makeDevice({ lastWifiChangeAt: new Date(Date.now() - 2 * 60 * 1000) }),
      );

      await expect(service.changeWifiCredentials('contract-1', credentials)).rejects.toThrow(ConflictException);
      expect(client.setWifiCredentials).not.toHaveBeenCalled();
    });

    it('permite el cambio si el último fue hace más de 10 minutos', async () => {
      resolver.resolveForContract.mockResolvedValue(
        makeDevice({ lastWifiChangeAt: new Date(Date.now() - 11 * 60 * 1000) }),
      );

      const result = await service.changeWifiCredentials('contract-1', credentials);

      expect(result.ssid).toBe('MiCasaWifi');
      expect(client.setWifiCredentials).toHaveBeenCalledWith('00259E-ONT-16', false, credentials);
    });

    it('aplica el cambio, actualiza el cache y registra auditoría OK', async () => {
      resolver.resolveForContract.mockResolvedValue(makeDevice());

      const result = await service.changeWifiCredentials('contract-1', credentials);

      expect(result.ssid).toBe('MiCasaWifi');
      expect(result.lastWifiChangeAt).toBeInstanceOf(Date);
      expect(result.lastSyncError).toBeNull();
      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          action: 'WIFI_CHANGE',
          result: 'OK',
          oldSsid: 'Sumtech_100M_OLD',
          newSsid: 'MiCasaWifi',
        }),
      );
    });

    it('si la NBI falla, registra auditoría ERROR y lanza BadGatewayException (no revienta silenciosamente)', async () => {
      resolver.resolveForContract.mockResolvedValue(makeDevice());
      client.setWifiCredentials.mockRejectedValue(new Error('GenieACS respondió con error 500'));

      await expect(service.changeWifiCredentials('contract-1', credentials)).rejects.toThrow(BadGatewayException);

      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WIFI_CHANGE', result: 'ERROR', errorMessage: 'GenieACS respondió con error 500' }),
      );
      expect(deviceRepo.save).toHaveBeenCalledWith(expect.objectContaining({ lastSyncError: 'GenieACS respondió con error 500' }));
    });

    it('resuelve isTR181 consultando el estado actual del dispositivo antes de aplicar el cambio', async () => {
      resolver.resolveForContract.mockResolvedValue(makeDevice());
      client.getDeviceStatus.mockResolvedValue({ isTR181: true });

      await service.changeWifiCredentials('contract-1', credentials);

      expect(client.setWifiCredentials).toHaveBeenCalledWith('00259E-ONT-16', true, credentials);
    });
  });
});
