import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { GenieAcsClient, GenieAcsDeviceStatus } from '../genieacs-client';
import {
  OnuTr069AssociatedDeviceEntry,
  OnuTr069GeneralSnapshot,
  OnuTr069HostEntry,
  OnuTr069IpInterfaceEntry,
  OnuTr069LanCounterEntry,
  OnuTr069LanDhcpServerSnapshot,
  OnuTr069LanPortEntry,
  OnuTr069PppInterfaceSnapshot,
  OnuTr069Snapshot,
  OnuTr069WirelessLanEntry,
  OnuTr069WlanCounterEntry,
} from '../dto/onu-tr069-snapshot.dto';
import {
  lanEthernetInterfaceBasePath,
  lanEthernetInterfaceCountPath,
  lanDhcpServerPaths,
  pppBasePath,
  wirelessLanPaths,
  wlanConfigurationCountPath,
} from './tr069-paths.util';
import { GenieAcsPortForwardingService } from './genieacs-port-forwarding.service';

/**
 * Normaliza el árbol TR-069 crudo de un CPE (TR-098 "InternetGatewayDevice"
 * vs TR-181 "Device") en un DTO único por sección, para la pestaña
 * "TR-069 / GenieACS" de la Ficha 360 de ONU -- ver
 * Plan_Implementacion_Pestana_TR069_Avanzada_ONU.md. El frontend nunca
 * necesita saber si el equipo es TR-098 o TR-181, igual que ya hace
 * `GenieAcsClient.getDeviceStatus` para SSID/potencia óptica.
 *
 * Secciones implementadas: General (§3.1), LAN Counters (§3.7), WLAN
 * Counters (§3.9), Hosts (§3.11), IP Interface (§3.4) -- todas de solo
 * lectura y bajo riesgo (Paso 2 del plan). Las demás 12 secciones se suman
 * en fases posteriores sobre este mismo servicio.
 */
@Injectable()
export class GenieAcsSnapshotService {
  constructor(
    @Optional()
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
    private readonly portForwardingService: GenieAcsPortForwardingService,
  ) {}

  private getClient(): GenieAcsClient {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'El servidor GenieACS no está configurado (falta GENIEACS_NBI_BASE_URL o GENIEACS_NBI_API_KEY).',
      );
    }
    return this.client;
  }

  async getFullSnapshot(deviceId: string): Promise<OnuTr069Snapshot> {
    const client = this.getClient();

    const status = await client.getDeviceStatus(deviceId);
    const isTR181 = status.isTR181;

    const [
      general,
      lanCounters,
      wlanCounters,
      hosts,
      ipInterfaces,
      pppInterface,
      lanDhcpServer,
      lanPorts,
      wirelessLan,
      portForwarding,
      voiceSupported,
    ] = await Promise.all([
      this.buildGeneral(client, deviceId, isTR181, status),
      this.buildLanCounters(client, deviceId, isTR181),
      this.buildWlanCounters(client, deviceId, isTR181),
      this.buildHosts(client, deviceId, isTR181),
      this.buildIpInterfaces(client, deviceId, isTR181),
      this.buildPppInterface(client, deviceId, isTR181),
      this.buildLanDhcpServer(client, deviceId, isTR181),
      this.buildLanPorts(client, deviceId, isTR181),
      this.buildWirelessLan(client, deviceId, isTR181),
      this.portForwardingService.getPortMappings(deviceId),
      this.buildVoiceSupported(client, deviceId, isTR181),
    ]);

    return {
      deviceId,
      isTR181,
      general,
      lanCounters,
      wlanCounters,
      hosts,
      ipInterfaces,
      voiceSupported,
      pppInterface,
      lanDhcpServer,
      lanPorts,
      wirelessLan,
      portForwarding,
    };
  }

  // ---------------------------------------------------------------------
  // §3.1 General
  // ---------------------------------------------------------------------

  private async buildGeneral(
    client: GenieAcsClient,
    deviceId: string,
    isTR181: boolean,
    status: GenieAcsDeviceStatus,
  ): Promise<OnuTr069GeneralSnapshot> {
    const paths = buildGeneralParameterPaths(isTR181);
    const values = await client.getParameterValues(deviceId, Object.values(paths));

    return {
      manufacturer: status.manufacturer,
      serialNumber: status.serialNumber,
      productClass: values[paths.productClass],
      modelName: values[paths.modelName],
      hardwareVersion: values[paths.hardwareVersion],
      softwareVersion: values[paths.softwareVersion],
      uptimeSeconds: parseNonNegativeInt(values[paths.uptime]),
      connectionRequestUrl: values[paths.connectionRequestUrl],
      cpuUsagePercent: parseNonNegativeInt(values[paths.cpuUsage]),
      memoryTotalKb: parseNonNegativeInt(values[paths.memoryTotal]),
      memoryFreeKb: parseNonNegativeInt(values[paths.memoryFree]),
      lastInformAt: status.lastInformAt,
      registeredAt: status.registeredAt,
      tags: status.tags,
    };
  }

  // ---------------------------------------------------------------------
  // §3.7 LAN Counters
  // ---------------------------------------------------------------------

  private async buildLanCounters(
    client: GenieAcsClient,
    deviceId: string,
    isTR181: boolean,
  ): Promise<OnuTr069LanCounterEntry[]> {
    const count = await this.getTableCount(client, deviceId, lanEthernetInterfaceCountPath(isTR181));
    if (count === 0) {
      return [];
    }

    const interfaceBase = lanEthernetInterfaceBasePath(isTR181);
    const fieldsFor = (i: number) => ({
      bytesSent: `${interfaceBase}.${i}.Stats.BytesSent`,
      bytesReceived: `${interfaceBase}.${i}.Stats.BytesReceived`,
      packetsSent: `${interfaceBase}.${i}.Stats.PacketsSent`,
      packetsReceived: `${interfaceBase}.${i}.Stats.PacketsReceived`,
      errorsSent: `${interfaceBase}.${i}.Stats.ErrorsSent`,
      errorsReceived: `${interfaceBase}.${i}.Stats.ErrorsReceived`,
    });

    const values = await this.batchGetParameterValues(client, deviceId, count, fieldsFor);

    const entries: OnuTr069LanCounterEntry[] = [];
    for (let i = 1; i <= count; i++) {
      const f = fieldsFor(i);
      entries.push({
        interfaceIndex: i,
        bytesSent: parseNonNegativeInt(values[f.bytesSent]),
        bytesReceived: parseNonNegativeInt(values[f.bytesReceived]),
        packetsSent: parseNonNegativeInt(values[f.packetsSent]),
        packetsReceived: parseNonNegativeInt(values[f.packetsReceived]),
        errorsSent: parseNonNegativeInt(values[f.errorsSent]),
        errorsReceived: parseNonNegativeInt(values[f.errorsReceived]),
      });
    }
    return entries;
  }

  // ---------------------------------------------------------------------
  // §3.9 WLAN Counters
  // ---------------------------------------------------------------------

  private async buildWlanCounters(
    client: GenieAcsClient,
    deviceId: string,
    isTR181: boolean,
  ): Promise<OnuTr069WlanCounterEntry[]> {
    const count = await this.getTableCount(client, deviceId, wlanConfigurationCountPath(isTR181));
    if (count === 0) {
      return [];
    }

    const fieldsFor = (i: number) =>
      isTR181
        ? {
            bytesSent: `Device.WiFi.SSID.${i}.Stats.BytesSent`,
            bytesReceived: `Device.WiFi.SSID.${i}.Stats.BytesReceived`,
            packetsSent: `Device.WiFi.SSID.${i}.Stats.PacketsSent`,
            packetsReceived: `Device.WiFi.SSID.${i}.Stats.PacketsReceived`,
          }
        : {
            bytesSent: `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.TotalBytesSent`,
            bytesReceived: `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.TotalBytesReceived`,
            packetsSent: `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.TotalPacketsSent`,
            packetsReceived: `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.TotalPacketsReceived`,
          };

    const values = await this.batchGetParameterValues(client, deviceId, count, fieldsFor);

    const entries: OnuTr069WlanCounterEntry[] = [];
    for (let i = 1; i <= count; i++) {
      const f = fieldsFor(i);
      entries.push({
        ssidIndex: i,
        totalBytesSent: parseNonNegativeInt(values[f.bytesSent]),
        totalBytesReceived: parseNonNegativeInt(values[f.bytesReceived]),
        totalPacketsSent: parseNonNegativeInt(values[f.packetsSent]),
        totalPacketsReceived: parseNonNegativeInt(values[f.packetsReceived]),
      });
    }
    return entries;
  }

  // ---------------------------------------------------------------------
  // §3.11 Hosts
  // ---------------------------------------------------------------------

  private async buildHosts(client: GenieAcsClient, deviceId: string, isTR181: boolean): Promise<OnuTr069HostEntry[]> {
    const countPath = isTR181
      ? 'Device.Hosts.HostNumberOfEntries'
      : 'InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries';
    const count = await this.getTableCount(client, deviceId, countPath);
    if (count === 0) {
      return [];
    }

    const fieldsFor = (i: number) => {
      const base = isTR181 ? `Device.Hosts.Host.${i}` : `InternetGatewayDevice.LANDevice.1.Hosts.Host.${i}`;
      return {
        ip: `${base}.IPAddress`,
        // TR-181 usa "PhysAddress", TR-098 usa "MACAddress" -- mismo campo, otro nombre.
        mac: isTR181 ? `${base}.PhysAddress` : `${base}.MACAddress`,
        hostName: `${base}.HostName`,
        interfaceType: `${base}.InterfaceType`,
        active: `${base}.Active`,
      };
    };

    const values = await this.batchGetParameterValues(client, deviceId, count, fieldsFor);

    const entries: OnuTr069HostEntry[] = [];
    for (let i = 1; i <= count; i++) {
      const f = fieldsFor(i);
      entries.push({
        ipAddress: values[f.ip],
        macAddress: values[f.mac],
        hostName: values[f.hostName],
        interfaceType: values[f.interfaceType],
        active: parseBoolean(values[f.active]),
      });
    }
    return entries;
  }

  // ---------------------------------------------------------------------
  // §3.4 IP Interface
  // ---------------------------------------------------------------------

  private async buildIpInterfaces(
    client: GenieAcsClient,
    deviceId: string,
    isTR181: boolean,
  ): Promise<OnuTr069IpInterfaceEntry[]> {
    if (isTR181) {
      const count = await this.getTableCount(client, deviceId, 'Device.IP.InterfaceNumberOfEntries');
      if (count === 0) {
        return [];
      }
      const fieldsFor = (i: number) => ({
        name: `Device.IP.Interface.${i}.Name`,
        enabled: `Device.IP.Interface.${i}.Enable`,
        ip: `Device.IP.Interface.${i}.IPv4Address.1.IPAddress`,
        mask: `Device.IP.Interface.${i}.IPv4Address.1.SubnetMask`,
        status: `Device.IP.Interface.${i}.Status`,
      });
      const values = await this.batchGetParameterValues(client, deviceId, count, fieldsFor);

      const entries: OnuTr069IpInterfaceEntry[] = [];
      for (let i = 1; i <= count; i++) {
        const f = fieldsFor(i);
        entries.push({
          index: i,
          name: values[f.name],
          enabled: parseBoolean(values[f.enabled]),
          ipAddress: values[f.ip],
          subnetMask: values[f.mask],
          connectionStatus: values[f.status],
        });
      }
      return entries;
    }

    // TR-098: ver nota de diseño en OnuTr069IpInterfaceEntry -- solo se lee
    // la instancia de servicio .1, la misma que gestiona la Etapa 3.
    const base = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1';
    const values = await client.getParameterValues(deviceId, [
      `${base}.ExternalIPAddress`,
      `${base}.SubnetMask`,
      `${base}.ConnectionStatus`,
    ]);
    const ip = values[`${base}.ExternalIPAddress`];
    const status = values[`${base}.ConnectionStatus`];
    if (!ip && !status) {
      return [];
    }
    return [
      {
        index: 1,
        name: 'WAN (servicio)',
        ipAddress: ip,
        subnetMask: values[`${base}.SubnetMask`],
        connectionStatus: status,
      },
    ];
  }

  // ---------------------------------------------------------------------
  // §3.2 PPP Interface
  // ---------------------------------------------------------------------

  private async buildPppInterface(
    client: GenieAcsClient,
    deviceId: string,
    isTR181: boolean,
  ): Promise<OnuTr069PppInterfaceSnapshot> {
    const base = pppBasePath(isTR181);
    const exists = await client.objectInstanceExists(deviceId, base);
    if (!exists) {
      return { supported: false };
    }

    // serviceName/connectionTrigger/DNSServers son conceptos reales de
    // TR-098 que TR-181 no estandariza en Device.PPP.Interface -- no se
    // consultan para TR-181 (quedan undefined a propósito, no por un fallo
    // de lectura). Ver nota en OnuTr069PppInterfaceSnapshot.
    const paths = {
      connectionStatus: `${base}.ConnectionStatus`,
      externalIp: isTR181 ? undefined : `${base}.ExternalIPAddress`,
      username: `${base}.Username`,
      serviceName: isTR181 ? undefined : `${base}.ServiceName`,
      lastConnectionError: `${base}.LastConnectionError`,
      maxMru: `${base}.MaxMRUSize`,
      connectionTrigger: isTR181 ? undefined : `${base}.ConnectionTrigger`,
      dnsServers: isTR181 ? undefined : `${base}.DNSServers`,
      lanInterface: isTR181 ? undefined : `${base}.X_CMCC_LanInterface`,
    };
    const queryPaths = Object.values(paths).filter((p): p is string => Boolean(p));
    const values = await client.getParameterValues(deviceId, queryPaths);

    const dnsServers = paths.dnsServers ? values[paths.dnsServers] : undefined;
    const [dns1, dns2] = dnsServers ? dnsServers.split(',').map((s) => s.trim()) : [undefined, undefined];

    return {
      supported: true,
      connectionStatus: values[paths.connectionStatus],
      externalIpAddress: paths.externalIp ? values[paths.externalIp] : undefined,
      username: values[paths.username],
      serviceName: paths.serviceName ? values[paths.serviceName] : undefined,
      lastConnectionError: values[paths.lastConnectionError],
      maxMruSize: parseNonNegativeInt(values[paths.maxMru]),
      connectionTrigger: paths.connectionTrigger ? values[paths.connectionTrigger] : undefined,
      dns1,
      dns2,
      lanInterface: paths.lanInterface ? values[paths.lanInterface] : undefined,
    };
  }

  // ---------------------------------------------------------------------
  // §3.5 LAN DHCP Server
  // ---------------------------------------------------------------------

  private async buildLanDhcpServer(
    client: GenieAcsClient,
    deviceId: string,
    isTR181: boolean,
  ): Promise<OnuTr069LanDhcpServerSnapshot> {
    const paths = lanDhcpServerPaths(isTR181);

    const values = await client.getParameterValues(deviceId, Object.values(paths));
    const dnsServers = values[paths.dnsServers];
    const [dns1, dns2] = dnsServers ? dnsServers.split(',').map((s) => s.trim()) : [undefined, undefined];

    return {
      enabled: parseBoolean(values[paths.enabled]),
      minAddress: values[paths.minAddress],
      maxAddress: values[paths.maxAddress],
      subnetMask: values[paths.subnetMask],
      dns1,
      dns2,
      domainName: values[paths.domainName],
      ipRouters: values[paths.ipRouters],
    };
  }

  // ---------------------------------------------------------------------
  // §3.6 LAN Ports
  // ---------------------------------------------------------------------

  private async buildLanPorts(client: GenieAcsClient, deviceId: string, isTR181: boolean): Promise<OnuTr069LanPortEntry[]> {
    const count = await this.getTableCount(client, deviceId, lanEthernetInterfaceCountPath(isTR181));
    if (count === 0) {
      return [];
    }

    const base = lanEthernetInterfaceBasePath(isTR181);
    const fieldsFor = (i: number) => ({
      enabled: `${base}.${i}.Enable`,
      status: `${base}.${i}.Status`,
    });
    const values = await this.batchGetParameterValues(client, deviceId, count, fieldsFor);

    const entries: OnuTr069LanPortEntry[] = [];
    for (let i = 1; i <= count; i++) {
      const f = fieldsFor(i);
      entries.push({ portIndex: i, enabled: parseBoolean(values[f.enabled]), status: values[f.status] });
    }
    return entries;
  }

  // ---------------------------------------------------------------------
  // §3.8 Wireless LAN (avanzado)
  // ---------------------------------------------------------------------

  private async buildWirelessLan(client: GenieAcsClient, deviceId: string, isTR181: boolean): Promise<OnuTr069WirelessLanEntry[]> {
    const count = await this.getTableCount(client, deviceId, wlanConfigurationCountPath(isTR181));
    if (count === 0) {
      return [];
    }

    const entries: OnuTr069WirelessLanEntry[] = [];
    for (let i = 1; i <= count; i++) {
      const paths = wirelessLanPaths(isTR181, i);
      const values = await client.getParameterValues(deviceId, Object.values(paths));
      entries.push({
        ssidIndex: i,
        ssid: values[paths.ssid],
        enabled: parseBoolean(values[paths.enabled]),
        ssidAdvertisementEnabled: parseBoolean(values[paths.ssidAdvertisement]),
        channel: parseNonNegativeInt(values[paths.channel]),
        autoChannelEnabled: parseBoolean(values[paths.autoChannel]),
        regulatoryDomain: values[paths.regulatoryDomain],
        associatedDevices: await this.buildAssociatedDevices(client, deviceId, isTR181, i),
      });
    }
    return entries;
  }

  private async buildAssociatedDevices(
    client: GenieAcsClient,
    deviceId: string,
    isTR181: boolean,
    ssidIndex: number,
  ): Promise<OnuTr069AssociatedDeviceEntry[]> {
    const countPath = isTR181
      ? `Device.WiFi.AccessPoint.${ssidIndex}.AssociatedDeviceNumberOfEntries`
      : `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${ssidIndex}.TotalAssociations`;
    const count = await this.getTableCount(client, deviceId, countPath);
    if (count === 0) {
      return [];
    }

    const fieldsFor = (j: number): { mac: string; downlink?: string; uplink?: string } =>
      isTR181
        ? {
            mac: `Device.WiFi.AccessPoint.${ssidIndex}.AssociatedDevice.${j}.MACAddress`,
          }
        : {
            mac: `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${ssidIndex}.AssociatedDevice.${j}.AssociatedDeviceMACAddress`,
            downlink: `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${ssidIndex}.AssociatedDevice.${j}.LastDataDownlinkRate`,
            uplink: `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${ssidIndex}.AssociatedDevice.${j}.LastDataUplinkRate`,
          };
    const values = await this.batchGetParameterValues(client, deviceId, count, fieldsFor);

    const devices: OnuTr069AssociatedDeviceEntry[] = [];
    for (let j = 1; j <= count; j++) {
      const f = fieldsFor(j);
      devices.push({
        macAddress: values[f.mac],
        lastDataDownlinkRate: f.downlink ? parseNonNegativeInt(values[f.downlink]) : undefined,
        lastDataUplinkRate: f.uplink ? parseNonNegativeInt(values[f.uplink]) : undefined,
      });
    }
    return devices;
  }

  // ---------------------------------------------------------------------
  // §3.13 Voice lines
  // ---------------------------------------------------------------------

  private async buildVoiceSupported(client: GenieAcsClient, deviceId: string, isTR181: boolean): Promise<boolean> {
    const base = isTR181
      ? 'Device.Services.VoiceService.1'
      : 'InternetGatewayDevice.Services.VoiceService.1';
    return client.objectInstanceExists(deviceId, base);
  }

  // ---------------------------------------------------------------------
  // Helpers compartidos
  // ---------------------------------------------------------------------

  private async getTableCount(client: GenieAcsClient, deviceId: string, countPath: string): Promise<number> {
    const values = await client.getParameterValues(deviceId, [countPath]);
    return parseNonNegativeInt(values[countPath]) ?? 0;
  }

  /** Arma los paths de 1..count vía `fieldsFor` y los consulta en UNA sola llamada batch a la NBI. */
  private async batchGetParameterValues(
    client: GenieAcsClient,
    deviceId: string,
    count: number,
    fieldsFor: (index: number) => Record<string, string | undefined>,
  ): Promise<Record<string, string | undefined>> {
    const paths: string[] = [];
    for (let i = 1; i <= count; i++) {
      paths.push(...Object.values(fieldsFor(i)).filter((p): p is string => Boolean(p)));
    }
    return client.getParameterValues(deviceId, paths);
  }
}

interface GeneralParameterPaths {
  productClass: string;
  modelName: string;
  hardwareVersion: string;
  softwareVersion: string;
  uptime: string;
  connectionRequestUrl: string;
  /** TR-098 no estandariza CPU -- se deja la misma ruta TR-181 como único candidato real conocido; en TR-098 simplemente no existe y llega `undefined`, nunca se inventa una extensión de fabricante sin confirmar en vivo. */
  cpuUsage: string;
  memoryTotal: string;
  memoryFree: string;
}

/**
 * `_deviceId._ProductClass` es metadato de GenieACS (no un parámetro TR-069
 * de verdad), así que no entra aquí -- se resuelve aparte si hiciera falta.
 * Por eso `productClass` sí usa una ruta TR-069 real (DeviceInfo.ProductClass
 * existe como parámetro espejo en ambos modelos de datos, 📘 estándar BBF).
 */
function buildGeneralParameterPaths(isTR181: boolean): GeneralParameterPaths {
  const root = isTR181 ? 'Device' : 'InternetGatewayDevice';
  return {
    productClass: `${root}.DeviceInfo.ProductClass`,
    modelName: `${root}.DeviceInfo.ModelName`,
    hardwareVersion: `${root}.DeviceInfo.HardwareVersion`,
    softwareVersion: `${root}.DeviceInfo.SoftwareVersion`,
    uptime: `${root}.DeviceInfo.UpTime`,
    connectionRequestUrl: `${root}.ManagementServer.ConnectionRequestURL`,
    cpuUsage: 'Device.DeviceInfo.ProcessStatus.CPUUsage',
    memoryTotal: 'Device.DeviceInfo.MemoryStatus.Total',
    memoryFree: 'Device.DeviceInfo.MemoryStatus.Free',
  };
}

function parseNonNegativeInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}
