import { Test, TestingModule } from '@nestjs/testing';
import { GenieAcsWebhookController } from './genieacs-webhook.controller';
import { UnauthorizedException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { GENIEACS_WEBHOOK_QUEUE, GENIEACS_WEBHOOK_JOBS } from '../genieacs-webhook.constants';

describe('GenieAcsWebhookController', () => {
  let controller: GenieAcsWebhookController;
  let mockQueue: { add: jest.Mock };

  beforeEach(async () => {
    process.env.GENIEACS_NBI_API_KEY = 'test-secret-123';

    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-webhook-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GenieAcsWebhookController],
      providers: [
        {
          provide: getQueueToken(GENIEACS_WEBHOOK_QUEUE),
          useValue: mockQueue,
        },
      ],
    }).compile();

    controller = module.get<GenieAcsWebhookController>(GenieAcsWebhookController);
  });

  afterEach(() => {
    delete process.env.GENIEACS_NBI_API_KEY;
  });

  it('debe aceptar eventos con el secreto por defecto si no hay variable de entorno', async () => {
    delete process.env.GENIEACS_NBI_API_KEY;

    const payload = {
      deviceId: 'DEV-01',
      eventType: 'BOOTSTRAP',
    };

    const result = await controller.handleDeviceEvent('sumtech-genieacs-secret-key-2026', payload);
    expect(result.success).toBe(true);
    expect(result.queued).toBe(true);
  });

  it('debe rechazar eventos con secret incorrecto o ausente', async () => {
    await expect(
      controller.handleDeviceEvent('wrong-secret', {
        deviceId: 'DEV-01',
        eventType: 'BOOTSTRAP',
      }),
    ).rejects.toThrow(UnauthorizedException);

    await expect(
      controller.handleDeviceEvent('', {
        deviceId: 'DEV-01',
        eventType: 'BOOTSTRAP',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('debe encolar el evento en BullMQ y responder de inmediato con 200 OK', async () => {
    const payload = {
      deviceId: '00259E-HG8546M-485754437C8E7143',
      eventType: 'BOOTSTRAP_COMPLETE',
      details: 'Dispositivo registrado en GenieACS',
      tags: ['ONLINE'],
    };

    const result = await controller.handleDeviceEvent('test-secret-123', payload);

    expect(result.success).toBe(true);
    expect(result.queued).toBe(true);
    expect(result.deviceId).toBe('00259E-HG8546M-485754437C8E7143');
    expect(mockQueue.add).toHaveBeenCalledWith(
      GENIEACS_WEBHOOK_JOBS.DEVICE_EVENT,
      payload,
      expect.objectContaining({
        removeOnComplete: true,
        removeOnFail: false,
      }),
    );
  });
});
