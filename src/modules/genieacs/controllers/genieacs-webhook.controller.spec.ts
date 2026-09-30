import { Test, TestingModule } from '@nestjs/testing';
import { GenieAcsWebhookController } from './genieacs-webhook.controller';
import { UnauthorizedException } from '@nestjs/common';

describe('GenieAcsWebhookController', () => {
  let controller: GenieAcsWebhookController;

  beforeEach(async () => {
    process.env.GENIEACS_ERP_SECRET = 'test-secret-123';

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GenieAcsWebhookController],
    }).compile();

    controller = module.get<GenieAcsWebhookController>(GenieAcsWebhookController);
  });

  afterEach(() => {
    delete process.env.GENIEACS_ERP_SECRET;
  });

  it('debe rechazar eventos con secret incorrecto o ausente', async () => {
    await expect(
      controller.handleDeviceEvent('wrong-secret', {
        deviceId: 'DEV-01',
        eventType: 'BOOTSTRAP',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('debe procesar evento y extraer tenant de tags', async () => {
    const result = await controller.handleDeviceEvent('test-secret-123', {
      deviceId: 'DEV-01',
      eventType: 'BOOTSTRAP_COMPLETE',
      tags: ['ONLINE', 'TENANT:isp-azua', 'BOOTSTRAPPED'],
      details: 'CPE registrado',
    });

    expect(result.success).toBe(true);
    expect(result.processed).toBe(true);
    expect(result.tenant).toBe('isp-azua');
    expect(result.deviceId).toBe('DEV-01');
  });
});
