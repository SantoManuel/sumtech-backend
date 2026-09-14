import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GenieAcsDeviceResolverService } from './genieacs-device-resolver.service';
import { GenieAcsDeviceEntity } from './entities/genieacs-device.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { GENIEACS_CLIENT } from './genieacs-client-factory';

describe('GenieAcsDeviceResolverService', () => {
  let service: GenieAcsDeviceResolverService;
  let deviceRepo: any;
  let serialRepo: any;
  let client: any;

  const makeDeviceRecord = (overrides: Partial<GenieAcsDeviceEntity> = {}): GenieAcsDeviceEntity =>
    ({
      id: 'device-record-1',
      contractId: 'contract-1',
      serialNumberId: undefined,
      genieacsDeviceId: undefined,
      lastSyncAt: undefined,
      lastSyncError: undefined,
      ...overrides,
    }) as GenieAcsDeviceEntity;

  const makeSerial = (overrides: Partial<SerialNumberEntity> = {}): SerialNumberEntity =>
    ({
      id: 'serial-1',
      serialNumber: 'SN-0001',
      status: 'ASSIGNED_TO_CLIENT',
      currentContractId: 'contract-1',
      ...overrides,
    }) as SerialNumberEntity;

  beforeEach(async () => {
    deviceRepo = {
      findOneBy: jest.fn(),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: entity.id || 'device-generated', ...entity })),
    };
    serialRepo = { find: jest.fn().mockResolvedValue([]) };
    client = { findDeviceBySerial: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenieAcsDeviceResolverService,
        { provide: getRepositoryToken(GenieAcsDeviceEntity), useValue: deviceRepo },
        { provide: getRepositoryToken(SerialNumberEntity), useValue: serialRepo },
        { provide: GENIEACS_CLIENT, useValue: client },
      ],
    }).compile();

    service = module.get<GenieAcsDeviceResolverService>(GenieAcsDeviceResolverService);
  });

  describe('findByContractId', () => {
    it('devuelve el registro guardado sin volver a consultar la NBI', async () => {
      deviceRepo.findOneBy.mockResolvedValue(makeDeviceRecord({ genieacsDeviceId: 'dev-1' }));

      const result = await service.findByContractId('contract-1');

      expect(result?.genieacsDeviceId).toBe('dev-1');
      expect(client.findDeviceBySerial).not.toHaveBeenCalled();
    });
  });

  describe('resolveForContract', () => {
    it('devuelve el registro existente sin llamar a la NBI si ya estaba resuelto', async () => {
      deviceRepo.findOneBy.mockResolvedValue(makeDeviceRecord({ genieacsDeviceId: 'dev-ya-resuelto' }));

      const result = await service.resolveForContract('contract-1');

      expect(result?.genieacsDeviceId).toBe('dev-ya-resuelto');
      expect(serialRepo.find).not.toHaveBeenCalled();
      expect(client.findDeviceBySerial).not.toHaveBeenCalled();
    });

    it('devuelve null si el contrato no tiene ningún equipo asignado todavía', async () => {
      deviceRepo.findOneBy.mockResolvedValue(null);
      serialRepo.find.mockResolvedValue([]);

      const result = await service.resolveForContract('contract-1');

      expect(result).toBeNull();
    });

    it('resuelve el deviceId probando cada serial asignado hasta encontrar uno que exista en GenieACS', async () => {
      deviceRepo.findOneBy.mockResolvedValue(null);
      serialRepo.find.mockResolvedValue([
        makeSerial({ id: 'serial-decoder', serialNumber: 'SN-DECODER' }),
        makeSerial({ id: 'serial-onu', serialNumber: 'SN-ONU-REAL' }),
      ]);
      client.findDeviceBySerial.mockImplementation((serial: string) =>
        Promise.resolve(serial === 'SN-ONU-REAL' ? '00259E-ONU-REAL' : null),
      );

      const result = await service.resolveForContract('contract-1');

      expect(client.findDeviceBySerial).toHaveBeenCalledWith('SN-DECODER');
      expect(client.findDeviceBySerial).toHaveBeenCalledWith('SN-ONU-REAL');
      expect(result?.genieacsDeviceId).toBe('00259E-ONU-REAL');
      expect(result?.serialNumberId).toBe('serial-onu');
      expect(result?.lastSyncError).toBeNull();
    });

    it('no vuelve a probar seriales una vez que uno resuelve (corta el ciclo)', async () => {
      deviceRepo.findOneBy.mockResolvedValue(null);
      serialRepo.find.mockResolvedValue([
        makeSerial({ id: 'serial-a', serialNumber: 'SN-A' }),
        makeSerial({ id: 'serial-b', serialNumber: 'SN-B' }),
      ]);
      client.findDeviceBySerial.mockResolvedValue('dev-encontrado-en-el-primero');

      await service.resolveForContract('contract-1');

      expect(client.findDeviceBySerial).toHaveBeenCalledTimes(1);
    });

    it('deja un mensaje claro si ningún equipo asignado resuelve en GenieACS', async () => {
      deviceRepo.findOneBy.mockResolvedValue(null);
      serialRepo.find.mockResolvedValue([makeSerial()]);
      client.findDeviceBySerial.mockResolvedValue(null);

      const result = await service.resolveForContract('contract-1');

      expect(result?.genieacsDeviceId).toBeUndefined();
      expect(result?.lastSyncError).toMatch(/ha hecho contacto/i);
    });

    it('si GenieACS no está configurado (cliente null), guarda un error claro sin intentar llamar a la NBI', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GenieAcsDeviceResolverService,
          { provide: getRepositoryToken(GenieAcsDeviceEntity), useValue: deviceRepo },
          { provide: getRepositoryToken(SerialNumberEntity), useValue: serialRepo },
          { provide: GENIEACS_CLIENT, useValue: null },
        ],
      }).compile();
      const unconfiguredService = module.get<GenieAcsDeviceResolverService>(GenieAcsDeviceResolverService);

      deviceRepo.findOneBy.mockResolvedValue(null);
      serialRepo.find.mockResolvedValue([makeSerial()]);

      const result = await unconfiguredService.resolveForContract('contract-1');

      expect(result?.lastSyncError).toMatch(/GenieACS no está configurado/i);
    });

    it('si la NBI falla con un error de red, lo captura y lo deja en lastSyncError sin propagar la excepción', async () => {
      deviceRepo.findOneBy.mockResolvedValue(null);
      serialRepo.find.mockResolvedValue([makeSerial()]);
      client.findDeviceBySerial.mockRejectedValue(new Error('timeout de GenieACS'));

      const result = await service.resolveForContract('contract-1');

      expect(result?.lastSyncError).toBe('timeout de GenieACS');
    });

    it('reutiliza el registro existente (sin duplicar) si ya había uno sin resolver todavía', async () => {
      deviceRepo.findOneBy.mockResolvedValue(makeDeviceRecord({ id: 'device-existente', genieacsDeviceId: undefined }));
      serialRepo.find.mockResolvedValue([makeSerial()]);
      client.findDeviceBySerial.mockResolvedValue('dev-1');

      const result = await service.resolveForContract('contract-1');

      expect(deviceRepo.create).not.toHaveBeenCalled();
      expect(result?.id).toBe('device-existente');
    });
  });
});
