import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import {
  ROUTEROS_CLIENT_FACTORY,
  ROUTEROS_BINARY_CLIENT_FACTORY,
  RouterOsClientFactory,
  RouterOsClientLike,
} from '../routeros/routeros-client-factory';
import { resolveRouterOsCredentials } from '../routeros/routeros-credentials';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { decryptCredential } from '../../network-connectivity/utils/crypto.util';

/**
 * Único punto de resolución de un cliente RouterOS para un nodo -- antes
 * duplicado casi idéntico (`resolveClient` privado) en
 * NetworkNodeInfrastructureService y PppManagementService.
 *
 * Además de centralizar esa lógica (Fase 0 del plan), decide la
 * IMPLEMENTACIÓN real del cliente según `node.transportType`:
 *   - 'REST'         -> RouterOsClient (REST/HTTP, sin cambios de comportamiento)
 *   - 'ROUTEROS_API' -> RouterOsBinaryClient (protocolo binario MikroTik, puerto 8728/8729)
 *   - 'SSH'          -> rechazado explícitamente: SSH no soporta la gestión
 *                       estructurada que necesitan estos servicios (ver
 *                       Plan_Implementacion_Soporte_API_Binaria_SSH.md,
 *                       sección "SSH: por qué no").
 */
@Injectable()
export class RouterOsClientResolverService {
  constructor(
    @Inject(ROUTEROS_CLIENT_FACTORY)
    private readonly restClientFactory: RouterOsClientFactory,
    @Inject(ROUTEROS_BINARY_CLIENT_FACTORY)
    private readonly binaryClientFactory: RouterOsClientFactory,
    private readonly reachabilityResolver: ReachabilityResolver,
  ) {}

  async resolveClient(node: NetworkNodeEntity): Promise<RouterOsClientLike> {
    if (node.transportType === 'SSH') {
      throw new BadRequestException(
        `El nodo "${node.name}" usa el Protocolo "SSH", que no soporta gestión estructurada ` +
          '(VLANs, PPP, NAT, DHCP, etc.). Cambia el Protocolo del nodo a REST o API Binaria en ' +
          '"Editar Nodo" para administrarlo desde aquí.',
      );
    }

    let host = node.managementIp;
    let port = node.apiPort;
    let useHttps = node.useHttps;

    try {
      const endpoint = await this.reachabilityResolver.resolveEndpoint(node);
      host = endpoint.host;
      port = endpoint.port;
      useHttps = endpoint.useHttps;
    } catch {
      // Fallback a managementIp
    }

    if (!host) {
      throw new Error(`El nodo "${node.name}" no tiene IP de gestión o túnel alcanzable.`);
    }

    let username = node.apiUser || 'admin';
    let password = '';

    if (node.apiPasswordEnc) {
      password = decryptCredential(node.apiPasswordEnc);
    } else {
      const credentials = resolveRouterOsCredentials(node.name);
      username = credentials.username;
      password = credentials.password;
    }

    const config = { managementIp: host, apiPort: port, useHttps, username, password };
    const factory = node.transportType === 'ROUTEROS_API' ? this.binaryClientFactory : this.restClientFactory;
    return factory(config);
  }
}
