/**
 * Builders de rutas TR-069 (TR-098 "InternetGatewayDevice" vs TR-181
 * "Device") compartidos entre lectura (`GenieAcsSnapshotService`) y escritura
 * (`GenieAcsSectionWriteService`) -- una sola fuente de verdad para cada OID,
 * así lectura y escritura nunca pueden divergir silenciosamente.
 */

/** Misma ruta base PPP ya usada (y confirmada en vivo) por CpeParameterMapper. */
export function pppBasePath(isTR181: boolean): string {
  return isTR181
    ? 'Device.PPP.Interface.1'
    : 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
}

export interface WirelessLanPaths {
  enabled: string;
  ssidAdvertisement: string;
  channel: string;
  autoChannel: string;
  regulatoryDomain: string;
}

export function wirelessLanPaths(isTR181: boolean, ssidIndex: number): WirelessLanPaths {
  if (isTR181) {
    return {
      enabled: `Device.WiFi.SSID.${ssidIndex}.Enable`,
      ssidAdvertisement: `Device.WiFi.SSID.${ssidIndex}.SSIDAdvertisementEnabled`,
      channel: `Device.WiFi.Radio.${ssidIndex}.Channel`,
      autoChannel: `Device.WiFi.Radio.${ssidIndex}.AutoChannelEnable`,
      regulatoryDomain: `Device.WiFi.Radio.${ssidIndex}.RegulatoryDomain`,
    };
  }
  const base = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${ssidIndex}`;
  return {
    enabled: `${base}.Enable`,
    ssidAdvertisement: `${base}.SSIDAdvertisementEnabled`,
    channel: `${base}.Channel`,
    autoChannel: `${base}.AutoChannelEnable`,
    regulatoryDomain: `${base}.RegulatoryDomain`,
  };
}

export interface LanDhcpServerPaths {
  enabled: string;
  minAddress: string;
  maxAddress: string;
  subnetMask: string;
  dnsServers: string;
  domainName: string;
  ipRouters: string;
}

export function lanDhcpServerPaths(isTR181: boolean): LanDhcpServerPaths {
  return isTR181
    ? {
        enabled: 'Device.DHCPv4.Server.Pool.1.Enable',
        minAddress: 'Device.DHCPv4.Server.Pool.1.MinAddress',
        maxAddress: 'Device.DHCPv4.Server.Pool.1.MaxAddress',
        subnetMask: 'Device.DHCPv4.Server.Pool.1.SubnetMask',
        dnsServers: 'Device.DHCPv4.Server.Pool.1.DNSServers',
        domainName: 'Device.DHCPv4.Server.Pool.1.DomainName',
        ipRouters: 'Device.DHCPv4.Server.Pool.1.IPRouters',
      }
    : {
        enabled: 'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DHCPServerEnable',
        minAddress: 'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.MinAddress',
        maxAddress: 'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.MaxAddress',
        subnetMask: 'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.SubnetMask',
        dnsServers: 'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DNSServers',
        domainName: 'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.DomainName',
        ipRouters: 'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.IPRouters',
      };
}

/** Misma tabla que ya usan LAN Counters (§3.7) y LAN Ports (§3.6) -- ambas secciones enumeran la MISMA interfaz Ethernet física. */
export function lanEthernetInterfaceCountPath(isTR181: boolean): string {
  return isTR181
    ? 'Device.Ethernet.InterfaceNumberOfEntries'
    : 'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfigNumberOfEntries';
}

export function lanEthernetInterfaceBasePath(isTR181: boolean): string {
  return isTR181 ? 'Device.Ethernet.Interface' : 'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig';
}

export function wlanConfigurationCountPath(isTR181: boolean): string {
  return isTR181 ? 'Device.WiFi.SSIDNumberOfEntries' : 'InternetGatewayDevice.LANDevice.1.WLANConfigurationNumberOfEntries';
}

/** Base de la conexión WAN IP (STATIC/DHCP) en TR-098 -- misma ruta ya usada por CpeParameterMapper. */
export function wanIpConnectionBasePath(): string {
  return 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1';
}

export interface PortMappingFieldPaths {
  enabled: string;
  protocol: string;
  externalPort: string;
  externalPortEndRange: string;
  internalPort: string;
  internalClient: string;
  description: string;
  leaseDuration: string;
}

/**
 * §3.3 del plan. TR-098 nombra los campos con el prefijo "PortMapping*"
 * (ej. "PortMappingEnabled"); TR-181 usa nombres cortos ("Enable") -- se
 * normaliza acá para que lectura/escritura compartan una sola fuente.
 */
export interface DiagnosticFieldMap {
  statePath: string;
  triggerPaths: Record<string, string>;
  resultPaths: Record<string, string>;
}

/**
 * §3.15/§3.10 del plan -- objetos TR-143 (Ping/Traceroute/Download/Upload),
 * estándar BBF presente en ambos modelos de datos bajo el mismo nombre de
 * hoja, solo cambia el root ("Device." vs "InternetGatewayDevice."). Site
 * Survey (NeighboringWiFiDiagnostic) es TR-181 únicamente -- devuelve `null`
 * en TR-098 en vez de adivinar una extensión de fabricante.
 */
export function diagnosticFieldMap(
  type: 'PING' | 'TRACEROUTE' | 'DOWNLOAD' | 'UPLOAD' | 'SITE_SURVEY',
  isTR181: boolean,
): DiagnosticFieldMap | null {
  const root = isTR181 ? 'Device' : 'InternetGatewayDevice';
  switch (type) {
    case 'PING': {
      const base = `${root}.IPPingDiagnostics`;
      return {
        statePath: `${base}.DiagnosticsState`,
        triggerPaths: { host: `${base}.Host`, numberOfRepetitions: `${base}.NumberOfRepetitions` },
        resultPaths: {
          successCount: `${base}.SuccessCount`,
          failureCount: `${base}.FailureCount`,
          averageResponseTime: `${base}.AverageResponseTime`,
          minimumResponseTime: `${base}.MinimumResponseTime`,
          maximumResponseTime: `${base}.MaximumResponseTime`,
        },
      };
    }
    case 'TRACEROUTE': {
      const base = `${root}.TraceRouteDiagnostics`;
      return {
        statePath: `${base}.DiagnosticsState`,
        triggerPaths: { host: `${base}.Host` },
        resultPaths: { responseTime: `${base}.ResponseTime`, routeHopsCount: `${base}.RouteHopsNumberOfEntries` },
      };
    }
    case 'DOWNLOAD': {
      const base = `${root}.DownloadDiagnostics`;
      return {
        statePath: `${base}.DiagnosticsState`,
        triggerPaths: { downloadUrl: `${base}.DownloadURL` },
        resultPaths: {
          romTime: `${base}.ROMTime`,
          bomTime: `${base}.BOMTime`,
          eomTime: `${base}.EOMTime`,
          testBytesReceived: `${base}.TestBytesReceived`,
        },
      };
    }
    case 'UPLOAD': {
      const base = `${root}.UploadDiagnostics`;
      return {
        statePath: `${base}.DiagnosticsState`,
        triggerPaths: { uploadUrl: `${base}.UploadURL`, testFileLength: `${base}.TestFileLength` },
        resultPaths: {
          romTime: `${base}.ROMTime`,
          bomTime: `${base}.BOMTime`,
          eomTime: `${base}.EOMTime`,
          testBytesSent: `${base}.TestBytesSent`,
        },
      };
    }
    case 'SITE_SURVEY': {
      if (!isTR181) {
        return null;
      }
      const base = 'Device.WiFi.NeighboringWiFiDiagnostic';
      return {
        statePath: `${base}.DiagnosticsState`,
        triggerPaths: {},
        resultPaths: { resultCount: `${base}.ResultNumberOfEntries` },
      };
    }
  }
}

export function traceRouteHopBasePath(isTR181: boolean): string {
  return `${isTR181 ? 'Device' : 'InternetGatewayDevice'}.TraceRouteDiagnostics.RouteHops`;
}

export function neighboringWifiResultBasePath(): string {
  return 'Device.WiFi.NeighboringWiFiDiagnostic.Result';
}

export function portMappingFieldPaths(isTR181: boolean, tableBase: string, index: number): PortMappingFieldPaths {
  const entry = `${tableBase}.${index}`;
  return isTR181
    ? {
        enabled: `${entry}.Enable`,
        protocol: `${entry}.Protocol`,
        externalPort: `${entry}.ExternalPort`,
        externalPortEndRange: `${entry}.ExternalPortEndRange`,
        internalPort: `${entry}.InternalPort`,
        internalClient: `${entry}.InternalClient`,
        description: `${entry}.Description`,
        leaseDuration: `${entry}.LeaseTime`,
      }
    : {
        enabled: `${entry}.PortMappingEnabled`,
        protocol: `${entry}.PortMappingProtocol`,
        externalPort: `${entry}.ExternalPort`,
        externalPortEndRange: `${entry}.ExternalPortEndRange`,
        internalPort: `${entry}.InternalPort`,
        internalClient: `${entry}.InternalClient`,
        description: `${entry}.PortMappingDescription`,
        leaseDuration: `${entry}.PortMappingLeaseDuration`,
      };
}
