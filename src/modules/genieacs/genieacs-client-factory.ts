import { ConfigService } from '@nestjs/config';
import { Provider } from '@nestjs/common';
import { GenieAcsClient } from './genieacs-client';

export const GENIEACS_CLIENT = 'GENIEACS_CLIENT';

/**
 * A diferencia de RouterOS (credenciales por nodo, resueltas bajo demanda),
 * GenieACS es un único servidor central para todo Sumtech — la configuración
 * es global, vía GENIEACS_NBI_BASE_URL/GENIEACS_NBI_API_KEY. Si no están
 * configuradas todavía (instalación nueva, o mientras se despliega el
 * servidor GenieACS de la Fase 00), el provider entrega `null` en vez de
 * tumbar el arranque completo del ERP — quien consuma el cliente decide
 * cómo fallar claramente en ese caso (ver GenieAcsDeviceResolverService).
 */
export const genieAcsClientFactoryProvider: Provider = {
  provide: GENIEACS_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): GenieAcsClient | null => {
    const baseUrl = configService.get<string>('GENIEACS_NBI_BASE_URL');
    const apiKey = configService.get<string>('GENIEACS_NBI_API_KEY');
    if (!baseUrl || !apiKey) {
      return null;
    }
    return new GenieAcsClient({ baseUrl, apiKey });
  },
};
