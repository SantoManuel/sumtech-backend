import { RouterOsClient, RouterOsClientConfig } from './routeros-client';

export const ROUTEROS_CLIENT_FACTORY = 'ROUTEROS_CLIENT_FACTORY';

export type RouterOsClientLike = Pick<
  RouterOsClient,
  'testConnection' | 'findPppSecretByName' | 'setPppSecretDisabled' | 'setPppSecretProfile' | 'ensureProfile'
>;

export type RouterOsClientFactory = (config: RouterOsClientConfig) => RouterOsClientLike;

/**
 * Único punto de construcción de un RouterOsClient real, inyectado por
 * token — así RouterOsShadowSyncService y RouterOsProvisioningAdapter
 * comparten la misma forma de obtener un cliente, y las pruebas pueden
 * sustituirlo por uno falso sin tocar HTTP real.
 */
export const routerOsClientFactoryProvider = {
  provide: ROUTEROS_CLIENT_FACTORY,
  useValue: ((config: RouterOsClientConfig) => new RouterOsClient(config)) as RouterOsClientFactory,
};
