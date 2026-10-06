import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

export interface WireguardTunnelParams {
  nodeName: string;
  nodeId: string;
  tenantSlug: string;
  assignedClientIp: string;
  serverEndpoint: string;
  serverPort?: number;
  serverPublicKey: string;
  /** Llave privada generada por el backend (ver NetworkNodesService.getWireguardScript) — se incrusta explícita para que el router nunca autogenere una que el ERP desconozca. */
  clientPrivateKey: string;
  clientPublicKey: string;
  allowedIps?: string;
  keepaliveSeconds?: number;
  /** Protocolo de gestión configurado para el nodo — decide qué servicio de RouterOS se habilita sobre el túnel. */
  transportType?: 'REST' | 'ROUTEROS_API' | 'SSH';
  useHttps?: boolean;
}

export interface GeneratedWireguardConfig {
  routerosScript: string;
  clientIp: string;
  serverEndpoint: string;
  listenPort: number;
  /** Comando para pegar manualmente en el servidor WireGuard central (Fase A — hasta que exista sumtech-wg-agent). */
  hubPeerCommand: string;
}

@Injectable()
export class WireguardManagerService {
  private readonly logger = new Logger(WireguardManagerService.name);

  /**
   * Genera un par de claves WireGuard compatibles (Curve25519 en Base64).
   */
  generateKeyPair(): { privateKey: string; publicKey: string } {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });

    // En WireGuard, la clave cruda son los últimos 32 bytes del DER PKCS#8/SPKI
    const rawPriv = privateKey.subarray(privateKey.length - 32);
    const rawPub = publicKey.subarray(publicKey.length - 32);

    return {
      privateKey: rawPriv.toString('base64'),
      publicKey: rawPub.toString('base64'),
    };
  }

  /**
   * Genera el script RouterOS .rsc para configurar el túnel WireGuard en el MikroTik del cliente.
   */
  generateRouterOsScript(params: WireguardTunnelParams): GeneratedWireguardConfig {
    const port = params.serverPort || 51820;
    const keepalive = params.keepaliveSeconds || 25;
    const allowedIps = params.allowedIps || '10.254.0.0/16';
    const cleanNodeName = params.nodeName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const useHttps = params.useHttps !== false;
    const transportType = params.transportType || 'REST';
    const serviceName =
      transportType === 'SSH' ? 'ssh' : transportType === 'ROUTEROS_API' ? (useHttps ? 'api-ssl' : 'api') : useHttps ? 'www-ssl' : 'www';
    const hubPeerCommand = `wg set wg0 peer ${params.clientPublicKey} allowed-ips ${params.assignedClientIp}/32`;

    const script = [
      `# ==============================================================================`,
      `# SUMTECH TELECOM - SCRIPT DE CONEXION WIREGUARD`,
      `# Nodo: ${params.nodeName} (Tenant: ${params.tenantSlug})`,
      `# Generado el: ${new Date().toISOString()}`,
      `#`,
      `# Clave publica de ESTE router (registrarla como peer en el hub central):`,
      `#   ${params.clientPublicKey}`,
      `# Comando sugerido para el hub (reemplazar wg0 si la interfaz del hub tiene otro nombre):`,
      `#   ${hubPeerCommand}`,
      `# ==============================================================================`,
      ``,
      `:log info "Iniciando configuracion de tunel WireGuard para Sumtech..."`,
      ``,
      `# 1. Crear interfaz WireGuard (si no existe) con la llave privada asignada por el ERP`,
      `/interface wireguard`,
      `:if ([:len [/interface wireguard find name="wg-sumtech"]] = 0) do={`,
      `    add name="wg-sumtech" private-key="${params.clientPrivateKey}" listen-port=${port} comment="Sumtech SaaS Tunnel - ${cleanNodeName}"`,
      `} else={`,
      `    set [find name="wg-sumtech"] private-key="${params.clientPrivateKey}" comment="Sumtech SaaS Tunnel - ${cleanNodeName}"`,
      `}`,
      ``,
      `# 2. Asignar direccion IP en la interfaz WireGuard`,
      `/ip address`,
      `:if ([:len [/ip address find interface="wg-sumtech"]] = 0) do={`,
      `    add address="${params.assignedClientIp}/30" interface="wg-sumtech" network="${this.calculateNetwork(params.assignedClientIp)}" comment="IP Tunel Sumtech"`,
      `} else={`,
      `    set [find interface="wg-sumtech"] address="${params.assignedClientIp}/30"`,
      `}`,
      ``,
      `# 3. Configurar Peer del Servidor Central Sumtech`,
      `/interface wireguard peers`,
      `:if ([:len [/interface wireguard peers find interface="wg-sumtech"]] = 0) do={`,
      `    add interface="wg-sumtech" \\`,
      `        public-key="${params.serverPublicKey}" \\`,
      `        endpoint-address="${params.serverEndpoint}" \\`,
      `        endpoint-port=${port} \\`,
      `        allowed-address="${allowedIps}" \\`,
      `        persistent-keepalive=${keepalive}s \\`,
      `        comment="Sumtech Central Hub Peer"`,
      `} else={`,
      `    set [find interface="wg-sumtech"] \\`,
      `        public-key="${params.serverPublicKey}" \\`,
      `        endpoint-address="${params.serverEndpoint}" \\`,
      `        endpoint-port=${port} \\`,
      `        allowed-address="${allowedIps}" \\`,
      `        persistent-keepalive=${keepalive}s`,
      `}`,
      ``,
      `# 4. Habilitar sobre el tunel el servicio de gestion segun el protocolo configurado`,
      `#    en Sumtech para este nodo (${transportType}).`,
      `#    IMPORTANTE (2 bugs confirmados en router real, RouterOS 7.23.7):`,
      `#    - el nombre del servicio va literal (no por variable): RouterOS solo`,
      `#      resuelve /ip service por nombre cuando esta escrito directo en el`,
      `#      comando; sustituido desde una variable da "no such item".`,
      `#    - el valor de "address" tambien va literal (no por variable ni por`,
      `#      concatenacion): un valor calculado en tiempo de ejecucion para esta`,
      `#      propiedad tipada da "invalid value for argument address"; solo el`,
      `#      literal escrito directo en el comando funciona. Por eso, si el`,
      `#      servicio ya tenia una restriccion de direccion propia (distinta a`,
      `#      la subred del tunel), este paso la REEMPLAZA en vez de combinarla`,
      `#      -- mismo comportamiento que el script original, sin regresion.`,
      `/ip service`,
      `:local currentAddr [get ${serviceName} address]`,
      `:if ([:find $currentAddr "${allowedIps}"] = nil) do={`,
      `    set ${serviceName} disabled=no address="${allowedIps}"`,
      `} else={`,
      `    set ${serviceName} disabled=no`,
      `}`,
      ``,
      `# 5. Permitir explicitamente el trafico de gestion entrante por el tunel.`,
      `#    Se inserta antes de la primera regla "drop" del chain input (si existe)`,
      `#    para que no quede atrapada detras de un catch-all; si el filtro esta`,
      `#    vacio (sin ninguna regla "drop"), simplemente se agrega al final.`,
      `/ip firewall filter`,
      `:if ([:len [find where in-interface="wg-sumtech" action=accept]] = 0) do={`,
      `    :local placeBeforeId ""`,
      `    :foreach dropRuleId in=[find where chain="input" action="drop"] do={`,
      `        :if ($placeBeforeId = "") do={ :set placeBeforeId $dropRuleId }`,
      `    }`,
      `    :if ($placeBeforeId != "") do={`,
      `        add chain=input in-interface="wg-sumtech" action=accept place-before=$placeBeforeId comment="Sumtech WG Tunnel - ${cleanNodeName}"`,
      `    } else={`,
      `        add chain=input in-interface="wg-sumtech" action=accept comment="Sumtech WG Tunnel - ${cleanNodeName}"`,
      `    }`,
      `}`,
      ``,
      `:log info "Tunel WireGuard Sumtech configurado exitosamente."`,
      `:put "Configuracion completada. IP del nodo en el tunel: ${params.assignedClientIp}. Clave publica de este router: ${params.clientPublicKey}"`,
      ``,
    ].join('\n');

    return {
      routerosScript: script,
      clientIp: params.assignedClientIp,
      serverEndpoint: `${params.serverEndpoint}:${port}`,
      listenPort: port,
      hubPeerCommand,
    };
  }

  private calculateNetwork(ip: string): string {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    if (parts.length === 4) {
      // Para /30, la red es el múltiplo de 4 anterior
      parts[3] = parts[3] - (parts[3] % 4);
      return parts.join('.');
    }
    return ip;
  }
}
