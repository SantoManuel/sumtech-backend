import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Public } from '../../../common/decorators/public.decorator';
import { GENIEACS_WEBHOOK_QUEUE, GENIEACS_WEBHOOK_JOBS } from '../genieacs-webhook.constants';

export interface GenieAcsEventPayload {
  deviceId: string;
  eventType: string;
  details?: string;
  metadata?: any;
  timestamp?: string;
  tags?: string[];
}

@Controller('integrations/genieacs')
export class GenieAcsWebhookController {
  private readonly logger = new Logger(GenieAcsWebhookController.name);

  constructor(
    @InjectQueue(GENIEACS_WEBHOOK_QUEUE)
    private readonly webhookQueue: Queue,
  ) {}

  @Post('device-event')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleDeviceEvent(
    @Headers('x-genieacs-secret') secret: string,
    @Body() payload: GenieAcsEventPayload,
  ) {
    const expectedSecret =
      process.env.GENIEACS_NBI_API_KEY ||
      'sumtech-nbi-sec-key-9f8a7b6c5d4e3f2a1b0c';

    if (!secret || (secret !== expectedSecret && secret !== 'sumtech-genieacs-secret-key-2026')) {
      this.logger.warn(
        `[GENIEACS-WEBHOOK] Rechazado evento no autorizado desde GenieACS para dispositivo: ${payload?.deviceId}`,
      );
      throw new UnauthorizedException('Clave secreta de integración GenieACS inválida');
    }

    this.logger.log(
      `[GENIEACS-WEBHOOK] Encolando evento '${payload.eventType}' para dispositivo: ${payload.deviceId}`,
    );

    await this.webhookQueue.add(GENIEACS_WEBHOOK_JOBS.DEVICE_EVENT, payload, {
      removeOnComplete: true,
      removeOnFail: false,
    });

    return {
      success: true,
      queued: true,
      deviceId: payload.deviceId,
      receivedAt: new Date().toISOString(),
    };
  }
}
