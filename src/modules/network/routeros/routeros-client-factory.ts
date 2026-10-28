import { RouterOsClient, RouterOsClientConfig } from './routeros-client';
import { RouterOsBinaryClient } from './routeros-binary-client';

export const ROUTEROS_CLIENT_FACTORY = 'ROUTEROS_CLIENT_FACTORY';
/** Fábrica del cliente de API Binaria (puerto 8728/8729) -- ver RouterOsClientResolverService. */
export const ROUTEROS_BINARY_CLIENT_FACTORY = 'ROUTEROS_BINARY_CLIENT_FACTORY';

export type RouterOsClientLike = Pick<
  RouterOsClient,
  | 'testConnection'
  | 'findPppSecretByName'
  | 'createPppSecret'
  | 'ensurePppSecret'
  | 'setPppSecretDisabled'
  | 'setPppSecretProfile'
  | 'findProfileByName'
  | 'createProfile'
  | 'updateProfile'
  | 'ensureProfile'
  | 'ensureSuspensionProfile'
  | 'getProfiles'
  | 'deleteProfile'
  | 'getIpPools'
  | 'getUsedPoolAddresses'
  | 'getPppSecrets'
  | 'findActiveSessionByName'
  | 'getActiveSessions'
  | 'killActiveSession'
  | 'addAddressListEntry'
  | 'removeAddressListEntry'
  | 'addFirewallNatRule'
  | 'updateFirewallNatRule'
  | 'addFirewallFilterRule'
  | 'findVlanInterfaceByVlanId'
  | 'listVlanInterfaces'
  | 'ensureVlanInterface'
  | 'findIpAddressByInterface'
  | 'ensureIpAddress'
  | 'removeIpAddress'
  | 'removeVlanInterface'
  | 'getIpAddresses'
  | 'findDhcpClientByInterface'
  | 'ensureDhcpClient'
  | 'findPppoeClientByName'
  | 'ensurePppoeClient'
  | 'findRouteByDestination'
  | 'ensureDefaultRoute'
  | 'ensureNatMasquerade'
  | 'findNatRuleByComment'
  | 'listNatRules'
  | 'ensureFirewallBaseline'
  | 'findFilterRuleByComment'
  | 'listFilterRules'
  | 'findIpPoolByName'
  | 'ensureIpPool'
  | 'findDhcpServerNetworkByAddress'
  | 'ensureDhcpServerNetwork'
  | 'findDhcpServerByInterface'
  | 'listDhcpServers'
  | 'ensureDhcpServer'
  | 'findStaticLeaseByMac'
  | 'ensureStaticLease'
  | 'setLeaseDisabled'
  | 'findSimpleQueueByName'
  | 'ensureSimpleQueue'
  | 'setSimpleQueueDisabled'
  | 'ensureAcsAutoProvisioning'
  | 'findPppoeServerByInterface'
  | 'listPppoeServers'
  | 'ensurePppoeServer'
  | 'createBackup'
  | 'exportConfig'
  | 'readFileChunks'
  | 'deleteFile'
  | 'checkPackageUpdates'
  | 'getInterfaces'
  | 'setInterfaceDisabled'
  | 'createIpPool'
  | 'updateIpPool'
  | 'deleteIpPool'
  | 'getDhcpLeases'
  | 'makeDhcpLeaseStatic'
  | 'deleteDhcpLease'
  | 'getSimpleQueues'
  | 'ensureAddressListEntry'
  | 'removeAddressListEntriesByComment'
  | 'removeFilterRulesByComment'
  | 'getRouterLogs'
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

/**
 * Único punto de construcción de un RouterOsBinaryClient real, mismo patrón
 * que routerOsClientFactoryProvider -- inyectado por token para que
 * RouterOsClientResolverService (y las pruebas) puedan sustituirlo sin tocar
 * el protocolo binario real.
 */
export const routerOsBinaryClientFactoryProvider = {
  provide: ROUTEROS_BINARY_CLIENT_FACTORY,
  useValue: ((config: RouterOsClientConfig) => new RouterOsBinaryClient(config)) as RouterOsClientFactory,
};
