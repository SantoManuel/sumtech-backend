import { Injectable, Logger } from '@nestjs/common';
import * as dns from 'dns/promises';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { NetErrorCode } from '../enums/net-error-code.enum';

export interface ResolvedEndpoint {
  host: string;
  port: number;
  useHttps: boolean;
  resolvedVia: 'WIREGUARD' | 'DDNS' | 'PUBLIC_IP' | 'DIRECT';
  resolvedIp?: string;
  warning?: string;
}

interface DnsCacheEntry {
  ip: string;
  expiresAt: number;
}

@Injectable()
export class ReachabilityResolver {
  private readonly logger = new Logger(ReachabilityResolver.name);
  private readonly dnsCache = new Map<string, DnsCacheEntry>();
  private readonly DNS_CACHE_TTL_MS = 60000; // 1 minuto de cache

  /**
   * Resuelve el endpoint de comunicación efectivo para el nodo según su método de conexión.
   */
  async resolveEndpoint(node: NetworkNodeEntity): Promise<ResolvedEndpoint> {
    const resolved = await this.resolveHost(node);

    // El método de conexión decide el HOST; el transporte decide el PUERTO/protocolo.
    // Si se habla SSH (aunque se llegue por WireGuard/DDNS/IP pública), siempre se usa
    // el puerto SSH dedicado del nodo, nunca el apiPort (ver sshPort en network-node.entity.ts).
    if (node.transportType === 'SSH' && node.connectionMethod !== 'ssh') {
      return {
        ...resolved,
        port: node.sshPort || 22,
        useHttps: false,
      };
    }

    return resolved;
  }

  private async resolveHost(node: NetworkNodeEntity): Promise<ResolvedEndpoint> {
    const method = node.connectionMethod || 'wireguard';
    const useHttps = node.useHttps !== false;

    switch (method) {
      case 'wireguard': {
        if (!node.wireguardIp) {
          throw new Error(`[${NetErrorCode.NET_TARGET_NOT_FOUND}] El nodo ${node.name} tiene método WireGuard pero no tiene wireguardIp asignada`);
        }
        return {
          host: node.wireguardIp,
          port: node.apiPort || (useHttps ? 443 : 80),
          useHttps,
          resolvedVia: 'WIREGUARD',
          resolvedIp: node.wireguardIp,
        };
      }

      case 'ddns': {
        if (!node.ddnsHostname) {
          throw new Error(`[${NetErrorCode.NET_DNS_RESOLUTION}] El nodo ${node.name} tiene método DDNS pero no tiene ddnsHostname configurado`);
        }

        const ip = await this.resolveHostname(node.ddnsHostname, node.managementIp);
        return {
          host: ip,
          port: node.apiPort || (useHttps ? 443 : 80),
          useHttps,
          resolvedVia: 'DDNS',
          resolvedIp: ip,
        };
      }

      case 'public_ip': {
        const ip = node.managementIp;
        if (!ip) {
          throw new Error(`[${NetErrorCode.NET_DEVICE_OFFLINE}] El nodo ${node.name} no tiene dirección IP configurada`);
        }

        let warning: string | undefined;
        if (this.isPrivateIp(ip)) {
          warning = `La IP configurada (${ip}) pertenece al espacio privado (RFC 1918) y no será accesible desde Internet sin NAT/DMZ.`;
          this.logger.warn(`Nodo ${node.name}: ${warning}`);
        }

        return {
          host: ip,
          port: node.apiPort || (useHttps ? 443 : 80),
          useHttps,
          resolvedVia: 'PUBLIC_IP',
          resolvedIp: ip,
          warning,
        };
      }

      case 'ssh': {
        const ip = node.managementIp;
        if (!ip) {
          throw new Error(`[${NetErrorCode.NET_DEVICE_OFFLINE}] El nodo ${node.name} no tiene dirección IP configurada`);
        }
        return {
          host: ip,
          port: node.sshPort || 22,
          useHttps: false,
          resolvedVia: 'DIRECT',
          resolvedIp: ip,
        };
      }

      case 'api':
      default: {
        const ip = node.managementIp;
        if (!ip) {
          throw new Error(`[${NetErrorCode.NET_DEVICE_OFFLINE}] El nodo ${node.name} no tiene dirección IP configurada`);
        }
        return {
          host: ip,
          port: node.apiPort || (useHttps ? 443 : 80),
          useHttps,
          resolvedVia: 'DIRECT',
          resolvedIp: ip,
        };
      }
    }
  }

  /**
   * Resuelve el nombre DNS con soporte de caché TTL y fallback a IP previa.
   */
  async resolveHostname(hostname: string, fallbackIp?: string): Promise<string> {
    const cached = this.dnsCache.get(hostname);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.ip;
    }

    try {
      const lookup = await dns.lookup(hostname, { family: 4 });
      this.dnsCache.set(hostname, {
        ip: lookup.address,
        expiresAt: Date.now() + this.DNS_CACHE_TTL_MS,
      });
      return lookup.address;
    } catch (err: any) {
      this.logger.error(`Error resolviendo DDNS ${hostname}: ${err.message}`);
      if (fallbackIp) {
        this.logger.warn(`Usando IP fallback ${fallbackIp} para ${hostname}`);
        return fallbackIp;
      }
      throw new Error(`[${NetErrorCode.NET_DNS_RESOLUTION}] No se pudo resolver el hostname DDNS: ${hostname}`);
    }
  }

  /**
   * Verifica si una dirección IPv4 está dentro de los rangos privados RFC 1918 o loopback.
   */
  isPrivateIp(ip: string): boolean {
    if (!ip) return false;
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(isNaN)) return false;

    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 127.0.0.0/8
    if (parts[0] === 127) return true;

    return false;
  }
}
