import { Injectable, Logger } from '@nestjs/common';
import { ReachabilityResolver } from './reachability-resolver.service';
import { RouterOsRestTransport } from '../transports/routeros-rest.transport';
import { RouterOsBinaryTransport } from '../transports/routeros-binary.transport';
import { RouterOsSshTransport } from '../transports/routeros-ssh.transport';
import {
  TransportConnectionTarget,
  ConnectionHandshakeResult,
} from '../interfaces/routeros-transport.interface';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { decryptCredential } from '../utils/crypto.util';

export interface PreflightCheckOptions {
  host?: string;
  port?: number;
  useHttps?: boolean;
  username?: string;
  password?: string;
  connectionMethod?: 'wireguard' | 'ddns' | 'public_ip' | 'api' | 'ssh';
  ddnsHostname?: string;
  wireguardIp?: string;
  transportType?: 'REST' | 'ROUTEROS_API' | 'SSH';
}

export interface PreflightCheckResult {
  success: boolean;
  latencyMs: number;
  detectedVersion?: string;
  boardName?: string;
  architecture?: string;
  recommendedTransport?: 'REST' | 'ROUTEROS_API' | 'SSH';
  resolvedEndpoint?: string;
  errorCode?: string;
  errorMessage?: string;
}

@Injectable()
export class ConnectionTestService {
  private readonly logger = new Logger(ConnectionTestService.name);

  constructor(
    private readonly reachabilityResolver: ReachabilityResolver,
    private readonly restTransport: RouterOsRestTransport,
    private readonly binaryTransport: RouterOsBinaryTransport,
    private readonly sshTransport: RouterOsSshTransport,
  ) {}

  /**
   * Realiza un pre-flight check de conectividad y autenticación contra un nodo existente.
   */
  async testNode(node: NetworkNodeEntity): Promise<PreflightCheckResult> {
    const resolved = await this.reachabilityResolver.resolveEndpoint(node);

    const password = node.apiPasswordEnc
      ? decryptCredential(node.apiPasswordEnc)
      : process.env.ROUTEROS_PASSWORD || '';
    const username = node.apiUser || process.env.ROUTEROS_USER || 'admin';

    return await this.executePreflight({
      host: resolved.host,
      port: resolved.port,
      useHttps: resolved.useHttps,
      username,
      password,
      transportType: node.transportType || 'REST',
    });
  }

  /**
   * Realiza un pre-flight check antes de persistir el nodo.
   */
  async executePreflight(options: PreflightCheckOptions): Promise<PreflightCheckResult> {
    const host = options.host || options.wireguardIp || options.ddnsHostname || '';
    if (!host) {
      return {
        success: false,
        latencyMs: 0,
        errorMessage: 'Se requiere una dirección IP, IP WireGuard o nombre de host DDNS para la prueba',
      };
    }

    const port = options.port || (options.useHttps ? 443 : 80);
    const username = options.username || process.env.ROUTEROS_USER || 'admin';
    const password = options.password || process.env.ROUTEROS_PASSWORD || '';
    const preferredTransport = options.transportType || 'REST';

    const target: TransportConnectionTarget = {
      host,
      port,
      username,
      password,
      useHttps: options.useHttps !== false,
      timeoutMs: 6000,
    };

    let result: ConnectionHandshakeResult;

    if (preferredTransport === 'REST') {
      result = await this.restTransport.testConnection(target);

      // Si REST falló por 404 (endpoint no encontrado), podría ser RouterOS v6 (que no soporta REST API)
      if (!result.success) {
        this.logger.log(`Prueba REST fallida contra ${host}, evaluando fallback a API Binaria 8728 (RouterOS v6)...`);
        const binaryTarget: TransportConnectionTarget = {
          ...target,
          port: 8728,
        };
        const binaryResult = await this.binaryTransport.testConnection(binaryTarget);
        if (binaryResult.success) {
          return {
            success: true,
            latencyMs: binaryResult.latencyMs,
            detectedVersion: binaryResult.version,
            boardName: binaryResult.boardName,
            architecture: binaryResult.architecture,
            recommendedTransport: 'ROUTEROS_API',
            resolvedEndpoint: `${host}:8728`,
          };
        }
      }
    } else if (preferredTransport === 'ROUTEROS_API') {
      result = await this.binaryTransport.testConnection(target);
    } else {
      result = await this.sshTransport.testConnection(target);
    }

    // Deducir versión y recomendación
    let recommendedTransport = preferredTransport;
    if (result.version) {
      if (result.version.startsWith('6.') && preferredTransport === 'REST') {
        recommendedTransport = 'ROUTEROS_API';
      }
    }

    return {
      success: result.success,
      latencyMs: result.latencyMs,
      detectedVersion: result.version,
      boardName: result.boardName,
      architecture: result.architecture,
      recommendedTransport,
      resolvedEndpoint: `${host}:${port}`,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    };
  }
}
