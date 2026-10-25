/**
 * Sección "General" de la pestaña TR-069/GenieACS de la Ficha 360 de ONU --
 * ver Plan_Implementacion_Pestana_TR069_Avanzada_ONU.md §3.1. Cualquier
 * campo que el CPE no reporte (ej. CPU/RAM en la mayoría de equipos TR-098,
 * que no estandarizan esos parámetros) llega como `undefined`, nunca se
 * inventa un valor -- el frontend lo muestra como "No reportado por este
 * equipo".
 */
export interface OnuTr069GeneralSnapshot {
  manufacturer?: string;
  serialNumber?: string;
  productClass?: string;
  modelName?: string;
  hardwareVersion?: string;
  softwareVersion?: string;
  /** Segundos desde el último arranque del equipo (DeviceInfo.UpTime). */
  uptimeSeconds?: number;
  /** URL que GenieACS usaría para pedirle al CPE que se conecte -- útil para diagnosticar NAT/firewall del lado del cliente. */
  connectionRequestUrl?: string;
  /** Solo disponible en TR-181 (Device.DeviceInfo.ProcessStatus.CPUUsage) -- TR-098 no estandariza esto, se deja sin inventar extensiones de fabricante no confirmadas. */
  cpuUsagePercent?: number;
  /** Solo disponible en TR-181 (Device.DeviceInfo.MemoryStatus) -- mismo motivo que cpuUsagePercent. */
  memoryTotalKb?: number;
  memoryFreeKb?: number;
  lastInformAt?: Date;
  registeredAt?: Date;
  tags: string[];
}

/** §3.7 del plan -- un elemento por interfaz Ethernet física, solo lectura. */
export interface OnuTr069LanCounterEntry {
  interfaceIndex: number;
  bytesSent?: number;
  bytesReceived?: number;
  packetsSent?: number;
  packetsReceived?: number;
  errorsSent?: number;
  errorsReceived?: number;
}

/** §3.9 del plan -- un elemento por SSID/radio, solo lectura. */
export interface OnuTr069WlanCounterEntry {
  ssidIndex: number;
  totalBytesSent?: number;
  totalBytesReceived?: number;
  totalPacketsSent?: number;
  totalPacketsReceived?: number;
}

/**
 * §3.11 del plan -- dispositivos conectados al LAN del cliente. TR-181 usa
 * "PhysAddress" en vez de "MACAddress" para el mismo campo -- se normaliza
 * acá para que el frontend no tenga que saberlo.
 */
export interface OnuTr069HostEntry {
  ipAddress?: string;
  macAddress?: string;
  hostName?: string;
  interfaceType?: string;
  active?: boolean;
}

/**
 * §3.4 del plan. En TR-181 se enumeran TODAS las instancias reales de
 * `Device.IP.Interface.{i}` (incluida, si existiera, la interfaz de gestión
 * TR-069 en una VLAN separada). En TR-098 **solo se lee la instancia .1** de
 * `WANIPConnection` (la misma que ya gestiona la Etapa 3 de esta ficha) --
 * los índices de `WANDevice`/`WANConnectionDevice` varían por fabricante y
 * no hay forma genérica confiable de enumerarlos sin arriesgar una ruta no
 * confirmada; se documenta la limitación en vez de adivinar.
 */
export interface OnuTr069IpInterfaceEntry {
  index: number;
  name?: string;
  enabled?: boolean;
  ipAddress?: string;
  subnetMask?: string;
  connectionStatus?: string;
}

/**
 * §3.2 del plan. `supported=false` cuando el CPE no tiene la instancia PPP
 * creada (ej. WAN en modo STATIC/DHCP, no PPPoE) -- en ese caso el resto de
 * los campos llega undefined, nunca inventados. Varios campos (serviceName,
 * connectionTrigger, dns1/dns2) son conceptos reales de TR-098 que TR-181 no
 * estandariza en `PPP.Interface` -- en TR-181 llegan undefined a propósito,
 * no por un fallo de lectura.
 */
export interface OnuTr069PppInterfaceSnapshot {
  supported: boolean;
  connectionStatus?: string;
  externalIpAddress?: string;
  username?: string;
  serviceName?: string;
  lastConnectionError?: string;
  maxMruSize?: number;
  connectionTrigger?: string;
  dns1?: string;
  dns2?: string;
}

/** §3.5 del plan -- servidor DHCP de la LAN del cliente. */
export interface OnuTr069LanDhcpServerSnapshot {
  enabled?: boolean;
  minAddress?: string;
  maxAddress?: string;
  subnetMask?: string;
  dns1?: string;
  dns2?: string;
  domainName?: string;
  ipRouters?: string;
}

/** §3.6 del plan -- un elemento por puerto Ethernet físico. */
export interface OnuTr069LanPortEntry {
  portIndex: number;
  enabled?: boolean;
  status?: string;
}

/** Dispositivo asociado a una radio WiFi -- solo lectura, parte de §3.8. */
export interface OnuTr069AssociatedDeviceEntry {
  macAddress?: string;
  lastDataDownlinkRate?: number;
  lastDataUplinkRate?: number;
}

/**
 * §3.8 del plan -- extensión del WiFi ya existente (SSID/password, ver
 * `setWifiCredentials`). Standard/ChannelWidth/TxPower se dejan FUERA a
 * propósito: son extensiones de fabricante sin una ruta TR-069 confirmada en
 * este tenant (⚠️ del plan) -- mejor no mostrarlos que adivinar mal.
 */
export interface OnuTr069WirelessLanEntry {
  ssidIndex: number;
  enabled?: boolean;
  ssidAdvertisementEnabled?: boolean;
  channel?: number;
  autoChannelEnabled?: boolean;
  regulatoryDomain?: string;
  associatedDevices: OnuTr069AssociatedDeviceEntry[];
}

/**
 * §3.3 del plan. En TR-098 la tabla de PortMapping vive dentro de la conexión
 * WAN que esté realmente activa (WANPPPConnection si el modo es PPPoE,
 * WANIPConnection si es STATIC/DHCP) -- se resuelve en runtime, nunca se
 * asume una de las dos a ciegas. En TR-181 vive en `Device.NAT.PortMapping`,
 * sin depender de qué interfaz IP esté activa.
 */
export interface OnuTr069PortMappingEntry {
  index: number;
  enabled?: boolean;
  protocol?: string;
  externalPort?: number;
  externalPortEndRange?: number;
  internalPort?: number;
  internalClient?: string;
  description?: string;
  leaseDuration?: number;
}

export interface OnuTr069Snapshot {
  deviceId: string;
  isTR181: boolean;
  general: OnuTr069GeneralSnapshot;
  lanCounters: OnuTr069LanCounterEntry[];
  wlanCounters: OnuTr069WlanCounterEntry[];
  hosts: OnuTr069HostEntry[];
  ipInterfaces: OnuTr069IpInterfaceEntry[];
  pppInterface: OnuTr069PppInterfaceSnapshot;
  lanDhcpServer: OnuTr069LanDhcpServerSnapshot;
  lanPorts: OnuTr069LanPortEntry[];
  wirelessLan: OnuTr069WirelessLanEntry[];
  portForwarding: OnuTr069PortMappingEntry[];
  /**
   * §3.13 del plan -- true solo si el CPE tiene creada la instancia
   * Services.VoiceService.1 (TR-104). Este tenant no vende VoIP hoy; se deja
   * el check de existencia listo para cuando lo haya, en vez de construir un
   * editor completo de líneas SIP sin ningún caso de uso real todavía.
   */
  voiceSupported: boolean;
}

/**
 * "Device Logs" (§3.16) reinterpretado honestamente: TR-069 no tiene un RPC
 * estándar para bajar el log interno del CPE -- esto es la actividad real
 * del lado de GenieACS (tareas encoladas + faults reales), no un volcado del
 * equipo. Ver GenieAcsActivityLogService.
 */
export interface GenieAcsActivityLogEntry {
  id: string;
  timestamp?: string;
  type: 'TASK' | 'FAULT';
  name: string;
  outcome: 'OK' | 'FAULT';
  detail?: string;
}
