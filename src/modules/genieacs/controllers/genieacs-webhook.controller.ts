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
import { Public } from '../../../common/decorators/public.decorator';

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

  @Post('device-event')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleDeviceEvent(
    @Headers('x-genieacs-secret') secret: string,
    @Body() payload: GenieAcsEventPayload,
  ) {
    const expectedSecret =
      process.env.GENIEACS_ERP_SECRET ||
      process.env.ERP_WEBHOOK_SECRET ||
      'sumtech-genieacs-secret-key-2026';

    if (!secret || secret !== expectedSecret) {
      this.logger.warn(
        `[GENIEACS-WEBHOOK] Rechazado evento no autorizado desde GenieACS para dispositivo: ${payload?.deviceId}`,
      );
      throw new UnauthorizedException('Clave secreta de integración GenieACS inválida');
    }

    // 1. Extraer tenant si viene indicado por tag TENANT:<slug>
    let tenantSlug: string | null = null;
    const tags: string[] = Array.isArray(payload.tags)
      ? payload.tags
      : Array.isArray(payload.metadata?.tags)
      ? payload.metadata.tags
      : [];

    for (const tag of tags) {
      if (typeof tag === 'string' && tag.toUpperCase().startsWith('TENANT:')) {
        tenantSlug = tag.substring(7).trim();
        break;
      }
    }

    this.logger.log(
      `[GENIEACS-WEBHOOK] Evento recibido: ${payload.eventType} | Dispositivo: ${payload.deviceId} | Tenant: ${tenantSlug || 'GLOBAL'} | Detalle: ${payload.details || 'N/A'}`,
    );

    return {
      success: true,
      processed: true,
      deviceId: payload.deviceId,
      tenant: tenantSlug,
      receivedAt: new Date().toISOString(),
    };
  }
}
