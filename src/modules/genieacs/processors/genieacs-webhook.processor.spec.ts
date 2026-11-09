import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { GenieAcsWebhookProcessor } from './genieacs-webhook.processor';
import { GenieAcsDeviceEntity } from '../entities/genieacs-device.entity';
import { GenieAcsAuditLogEntity } from '../entities/genieacs-audit-log.entity';
import { SerialNumberEntity } from '../../inventory/entities/serial-number.entity';
import { TenantIteratorService } from '../../../common/tenancy/tenant-iterator.service';
import { GENIEACS_WEBHOOK_JOBS, GENIEACS_EVENTS } from '../genieacs-webhook.constants';

describe('GenieAcsWebhookProcessor', () => {
  let processor: GenieAcsWebhookProcessor;
  let mockDeviceRepo: any;
  let mockAuditRepo: any;
  let mockSerialRepo: any;
  let mockTenantIterator: any;
  let mockEventEmitter: any;

  beforeEach(async () => {
    mockDeviceRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((d) => Promise.resolve({ ...d })),
    };

    mockAuditRepo = {
      save: jest.fn().mockImplementation((a) => Promise.resolve({ id: 'audit-1', ...a })),
    };

    mockSerialRepo = {
      findOne: jest.fn(),
    };

    mockTenantIterator = {
      runForEachActiveTenant: jest.fn().mockImplementation(async (_label, callback) => {
        // Simular ejecución para tenant 'sumtech'
        await callback({ id: 'tenant-1', slug: 'sumtech' });
      }),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenieAcsWebhookProcessor,
        {
          provide: getRepositoryToken(GenieAcsDeviceEntity),
          useValue: mockDeviceRepo,
        },
        {
          provide: getRepositoryToken(GenieAcsAuditLogEntity),
          useValue: mockAuditRepo,
        },
        {
          provide: getRepositoryToken(SerialNumberEntity),
          useValue: mockSerialRepo,
        },
        {
          provide: TenantIteratorService,
          useValue: mockTenantIterator,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    processor = module.get<GenieAcsWebhookProcessor>(GenieAcsWebhookProcessor);
  });

  it('procesa BOOTSTRAP_COMPLETE actualizando estado online y emitiendo evento', async () => {
    const existingDevice: Partial<GenieAcsDeviceEntity> = {
      id: 'dev-entity-1',
      contractId: 'contract-uuid-1',
      genieacsDeviceId: '00259E-HG8546M-485754437C8E7143',
      onlineStatus: 'OFFLINE',
    };
    mockDeviceRepo.findOne.mockResolvedValue(existingDevice);

    const job = {
      name: GENIEACS_WEBHOOK_JOBS.DEVICE_EVENT,
      data: {
        deviceId: '00259E-HG8546M-485754437C8E7143',
        eventType: 'BOOTSTRAP_COMPLETE',
        details: 'CPE registrado en GenieACS',
      },
    } as Job;

    const result = await processor.process(job);

    expect(result.processed).toBe(true);
    expect(result.tenant).toBe('sumtech');
    expect(existingDevice.onlineStatus).toBe('ONLINE');
    expect(mockDeviceRepo.save).toHaveBeenCalled();
    expect(mockAuditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'contract-uuid-1',
        genieacsDeviceId: '00259E-HG8546M-485754437C8E7143',
        action: 'TR069_PARAMETER_CHANGE',
      }),
    );
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      GENIEACS_EVENTS.BOOTSTRAP_COMPLETE,
      expect.objectContaining({
        tenant: 'sumtech',
        contractId: 'contract-uuid-1',
      }),
    );
  });

  it('procesa PLAN_APPLIED y registra auditoría', async () => {
    const existingDevice: Partial<GenieAcsDeviceEntity> = {
      id: 'dev-entity-1',
      contractId: 'contract-uuid-1',
      genieacsDeviceId: '00259E-HG8546M-485754437C8E7143',
    };
    mockDeviceRepo.findOne.mockResolvedValue(existingDevice);

    const job = {
      name: GENIEACS_WEBHOOK_JOBS.DEVICE_EVENT,
      data: {
        deviceId: '00259E-HG8546M-485754437C8E7143',
        eventType: 'PLAN_APPLIED',
        details: 'Configuración de plan-100 aplicada exitosamente',
      },
    } as Job;

    const result = await processor.process(job);

    expect(result.processed).toBe(true);
    expect(mockAuditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TR069_PARAMETER_CHANGE',
        parameterPath: 'PlanConfig',
        newValue: 'Configuración de plan-100 aplicada exitosamente',
      }),
    );
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      GENIEACS_EVENTS.PLAN_APPLIED,
      expect.anything(),
    );
  });

  it('procesa OPTICAL_ALARM extrayendo potencia óptica en dBm', async () => {
    const existingDevice: Partial<GenieAcsDeviceEntity> = {
      id: 'dev-entity-1',
      contractId: 'contract-uuid-1',
      genieacsDeviceId: '00259E-HG8546M-485754437C8E7143',
    };
    mockDeviceRepo.findOne.mockResolvedValue(existingDevice);

    const job = {
      name: GENIEACS_WEBHOOK_JOBS.DEVICE_EVENT,
      data: {
        deviceId: '00259E-HG8546M-485754437C8E7143',
        eventType: 'OPTICAL_ALARM',
        details: 'Potencia óptica degradada: -28.5 dBm',
      },
    } as Job;

    const result = await processor.process(job);

    expect(result.processed).toBe(true);
    expect(existingDevice.opticalRxPowerDbm).toBe(-28.5);
    expect(mockAuditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DIAGNOSTIC_RUN',
        parameterPath: 'OpticalRxPower',
      }),
    );
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      GENIEACS_EVENTS.OPTICAL_ALARM,
      expect.objectContaining({
        rxPower: -28.5,
      }),
    );
  });

  it('maneja dispositivos huérfanos sin fallar el job', async () => {
    mockDeviceRepo.findOne.mockResolvedValue(null);
    mockSerialRepo.findOne.mockResolvedValue(null);

    const job = {
      name: GENIEACS_WEBHOOK_JOBS.DEVICE_EVENT,
      data: {
        deviceId: 'DEVICE-UNKNOWN-999',
        eventType: 'BOOTSTRAP_COMPLETE',
      },
    } as Job;

    const result = await processor.process(job);

    expect(result.processed).toBe(true);
    expect(result.orphan).toBe(true);
    expect(mockDeviceRepo.save).not.toHaveBeenCalled();
  });
});

