import { Injectable } from '@nestjs/common';
import {
  resolveCpeIpv6Capabilities,
  CpeIpv6Capabilities,
  CpeIpv6CapabilityNotes,
} from './cpe-capabilities';

export interface CpeManagementServerConfig {
  acsUrl: string;
  acsUsername?: string;
  acsPassword?: string;
  connReqUsername?: string;
  connReqPassword?: string;
  informIntervalSec?: number;
}

export interface CpeConfigurationInput {
  vendor?: string;
  model?: string;
  serialNumber: string;
  tenantSlug?: string;
  /** Nombre de la OLT a la que está conectado este CPE -- usado para el tag "OLT:<nombre>" (ver CpeConfiguratorService.configureCpe). */
  oltName?: string;
  operationMode?: 'BRIDGE' | 'ROUTER';
  ipProtocol?: 'IPV4' | 'IPV6' | 'DUAL';
  wanMode?: 'STATIC' | 'DHCP' | 'PPPOE';
  serviceVlan?: number;
  // PPPoE
  pppoeUsername?: string;
  pppoePassword?: string;
  // Static IP (IPv4)
  wanStaticIp?: string;
  wanStaticMask?: string;
  wanStaticGw?: string;
  // Static IP (IPv6) -- Fase 3.3
  wanStaticIpv6?: string;
  wanStaticIpv6PrefixLen?: number;
  wanStaticIpv6Gw?: string;
  wanStaticIpv6Dns1?: string;
  wanStaticIpv6Dns2?: string;
  // DNS manual (override) -- aplica a cualquier wanMode, confirmado en vivo
  // como parámetro real (DNSServers/DNSOverrideAllowed) en WANPPPConnection
  // y WANIPConnection para TR-098 (2026-10-22). TR-181 no implementado
  // todavía -- ese modelo de datos pide un objeto Device.DNS.Client.Server
  // por servidor en vez de un solo campo de texto, sin verificar en vivo.
  dns1?: string;
  dns2?: string;
  // Management Server
  managementServer?: CpeManagementServerConfig;
  // WiFi
  wifi?: {
    ssid?: string;
    password?: string;
    ssid5g?: string;
  };
}

/**
 * Interfaces LAN (puertos Ethernet físicos 1 al 4) y WLAN (radios Wi-Fi 2.4GHz y 5GHz)
 * para vincular a la conexión WAN en TR-098 (Port Binding / X_CMCC_LanInterface).
 * Sin esto, la ONU solo asigna los puertos cableados y los dispositivos conectados
 * por Wi-Fi quedan aislados sin salida a internet.
 */
export const DEFAULT_TR098_LAN_WLAN_BINDING = [
  'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1',
  'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.2',
  'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.3',
  'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.4',
  'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1',
  'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2',
].join(',');

@Injectable()
export class CpeParameterMapper {
  /**
   * Genera la lista de [paramPath, value, type] para setParameterValues según el modelo (TR-181 vs TR-098)
   * y fabricante (ZTE, Huawei, etc.).
   */
  buildParameterValues(
    config: CpeConfigurationInput,
    isTR181: boolean,
  ): Array<[string, string, string]> {
    const params: Array<[string, string, string]> = [];
    const vendorUpper = (config.vendor || '').toUpperCase();

    if (isTR181) {
      this.buildTR181Params(config, params, vendorUpper);
    } else {
      this.buildTR098Params(config, params, vendorUpper);
    }

    return params;
  }

  /**
   * Aviso honesto cuando "Dual-Stack IPv4/IPv6" fue solicitado pero este modo
   * de WAN todavía no tiene ningún parámetro TR-069 de IPv6 implementado --
   * ver Plan_Implementacion_IPv6_Dual_Stack_WAN.md. Sin esto, `buildTR098Params`/
   * `buildTR181Params` simplemente ignoran `ipProtocol` en DHCP/STATIC y el
   * llamador reporta éxito como si el Dual-Stack se hubiera aplicado.
   *
   * PPPoE no entra acá a propósito: ese modo SÍ activa un parámetro real
   * (`IPv6CPEnable`/`X_BROADCOM_COM_IPv6PrefixDelegationEnabled`, ver
   * `buildTR181Params`/`buildTR098Params`) -- parcial (sin confirmar la
   * dirección/prefijo asignado todavía, Fase 3.1 del plan), pero no es un
   * no-op como DHCP/STATIC, así que no amerita el mismo aviso de "no se
   * aplicó nada".
   */
  getIpv6Warning(config: CpeConfigurationInput, isTR181?: boolean): string | undefined {
    if (config.ipProtocol !== 'DUAL' && config.ipProtocol !== 'IPV6') {
      return undefined;
    }
    // TR-181 implementa tanto DHCPv6 como Static IPv6 formalmente
    if (isTR181) {
      return undefined;
    }
    // En modo STATIC, si se suministraron parámetros estáticos IPv6, no hay warning
    if (config.wanMode === 'STATIC' && config.wanStaticIpv6) {
      return undefined;
    }
    if (config.wanMode === 'DHCP' || config.wanMode === 'STATIC') {
      const { notes } = resolveCpeIpv6Capabilities(config.vendor, config.model, isTR181);
      const capKey = config.wanMode === 'DHCP' ? 'dhcpDualStack' : 'staticIpv6';
      const specificReason = notes[capKey];
      const reasonDetail = specificReason ? ` (${specificReason})` : '';

      return (
        `Dual-Stack IPv4/IPv6 solicitado en modo ${config.wanMode}, pero todavía no hay parámetros TR-069 ` +
        `implementados para esto${reasonDetail} -- solo se aplicó IPv4. Ver Plan_Implementacion_IPv6_Dual_Stack_WAN.md.`
      );
    }
    return undefined;
  }

  /**
   * Consulta las capacidades IPv6 reales y las notas explicativas para este CPE
   * según su fabricante, modelo y estándar TR-069 (ver cpe-capabilities.ts).
   */
  getIpv6Capabilities(
    config: CpeConfigurationInput,
    isTR181?: boolean,
  ): { capabilities: CpeIpv6Capabilities; notes: CpeIpv6CapabilityNotes } {
    return resolveCpeIpv6Capabilities(config.vendor, config.model, isTR181);
  }

  /**
   * Extrae la dirección IPv6 y/o el prefijo delegado asignado en vivo por el ONT
   * a partir del objeto de verificación leído tras aplicar la configuración (Fase 3.1).
   */
  extractIpv6Readback(
    verification: Record<string, string | undefined>,
    isTR181: boolean,
  ): { prefix?: string; address?: string } {
    if (!verification) return {};

    if (isTR181) {
      const prefix = verification['Device.IP.Interface.1.IPv6Prefix.1.Prefix'];
      const address = verification['Device.IP.Interface.1.IPv6Address.1.IPAddress'];
      return {
        prefix: prefix && prefix !== '::/0' && prefix !== '' ? prefix : undefined,
        address: address && address !== '::' && address !== '' ? address : undefined,
      };
    }

    const pppBase = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
    const prefix =
      verification[`${pppBase}.X_BROADCOM_COM_IPv6PrefixDelegationPrefix`] ||
      verification[`${pppBase}.X_CMCC_IPv6Prefix`] ||
      verification[`${pppBase}.X_HW_IPv6Prefix`];

    const address =
      verification[`${pppBase}.IPv6Address`] ||
      verification[`${pppBase}.X_BROADCOM_COM_IPv6Address`] ||
      verification[`${pppBase}.X_HW_IPv6Address`];

    return {
      prefix: prefix && prefix !== '::/0' && prefix !== '' ? prefix : undefined,
      address: address && address !== '::' && address !== '' ? address : undefined,
    };
  }

  /**
   * Parámetros clave a verificar tras la aplicación para comprobar que el CPE los aceptó.
   */
  getVerificationParameters(config: CpeConfigurationInput, isTR181: boolean): string[] {
    const verification: string[] = [];
    if (isTR181) {
      if (config.wanMode === 'PPPOE') {
        verification.push('Device.PPP.Interface.1.Enable', 'Device.PPP.Interface.1.Username');
        if (config.ipProtocol === 'DUAL' || config.ipProtocol === 'IPV6') {
          verification.push(
            'Device.PPP.Interface.1.IPv6CPEnable',
            'Device.IP.Interface.1.IPv6Prefix.1.Prefix',
            'Device.IP.Interface.1.IPv6Address.1.IPAddress',
          );
        }
      } else if (config.wanMode === 'STATIC') {
        verification.push('Device.IP.Interface.1.IPv4Address.1.IPAddress');
        if (config.ipProtocol === 'DUAL' || config.ipProtocol === 'IPV6') {
          verification.push('Device.IP.Interface.1.IPv6Address.1.IPAddress');
        }
      }
      if (config.managementServer?.acsUrl) {
        verification.push('Device.ManagementServer.URL');
      }
    } else {
      const pppBase = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
      const ipBase = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1';
      if (config.wanMode === 'PPPOE') {
        verification.push(
          `${pppBase}.Enable`,
          `${pppBase}.Username`,
        );
        if (config.ipProtocol === 'DUAL' || config.ipProtocol === 'IPV6') {
          verification.push(
            `${pppBase}.X_BROADCOM_COM_IPv6PrefixDelegationEnabled`,
            `${pppBase}.X_BROADCOM_COM_IPv6PrefixDelegationPrefix`,
            `${pppBase}.X_CMCC_IPv6Prefix`,
            `${pppBase}.X_HW_IPv6Prefix`,
            `${pppBase}.IPv6Address`,
            `${pppBase}.X_BROADCOM_COM_IPv6Address`,
          );
        }
      } else if (config.wanMode === 'STATIC') {
        verification.push(
          `${ipBase}.ExternalIPAddress`,
        );
      }
      if (config.managementServer?.acsUrl) {
        verification.push('InternetGatewayDevice.ManagementServer.URL');
      }
    }
    return verification;
  }

  private buildTR181Params(
    config: CpeConfigurationInput,
    params: Array<[string, string, string]>,
    vendorUpper: string,
  ): void {
    // 1. ManagementServer
    if (config.managementServer) {
      const ms = config.managementServer;
      params.push(['Device.ManagementServer.URL', ms.acsUrl, 'xsd:string']);
      if (ms.acsUsername) {
        params.push(['Device.ManagementServer.Username', ms.acsUsername, 'xsd:string']);
      }
      if (ms.acsPassword) {
        params.push(['Device.ManagementServer.Password', ms.acsPassword, 'xsd:string']);
      }
      if (ms.connReqUsername) {
        params.push(['Device.ManagementServer.ConnectionRequestUsername', ms.connReqUsername, 'xsd:string']);
      }
      if (ms.connReqPassword) {
        params.push(['Device.ManagementServer.ConnectionRequestPassword', ms.connReqPassword, 'xsd:string']);
      }
      const interval = ms.informIntervalSec ?? 300;
      params.push(['Device.ManagementServer.PeriodicInformInterval', String(interval), 'xsd:unsignedInt']);
      params.push(['Device.ManagementServer.PeriodicInformEnable', 'true', 'xsd:boolean']);
    }

    // 2. WAN & PPP
    if (config.wanMode === 'PPPOE') {
      params.push(['Device.PPP.Interface.1.Enable', 'true', 'xsd:boolean']);
      if (config.pppoeUsername) {
        params.push(['Device.PPP.Interface.1.Username', config.pppoeUsername, 'xsd:string']);
      }
      if (config.pppoePassword) {
        params.push(['Device.PPP.Interface.1.Password', config.pppoePassword, 'xsd:string']);
      }
      if (config.serviceVlan) {
        params.push(['Device.Ethernet.VLANTermination.1.VLANID', String(config.serviceVlan), 'xsd:unsignedInt']);
        params.push(['Device.Ethernet.VLANTermination.1.Enable', 'true', 'xsd:boolean']);
      }
      if (config.ipProtocol === 'IPV6' || config.ipProtocol === 'DUAL') {
        params.push(['Device.PPP.Interface.1.IPv6CPEnable', 'true', 'xsd:boolean']);
      }
    } else if (config.wanMode === 'STATIC') {
      params.push(['Device.IP.Interface.1.Enable', 'true', 'xsd:boolean']);
      if (config.wanStaticIp) {
        params.push(['Device.IP.Interface.1.IPv4Address.1.IPAddress', config.wanStaticIp, 'xsd:string']);
      }
      if (config.wanStaticMask) {
        params.push(['Device.IP.Interface.1.IPv4Address.1.SubnetMask', config.wanStaticMask, 'xsd:string']);
      }
      if (config.wanStaticGw) {
        params.push(['Device.Routing.Router.1.IPv4Forwarding.1.GatewayIPAddress', config.wanStaticGw, 'xsd:string']);
      }
      if (config.ipProtocol === 'DUAL' || config.ipProtocol === 'IPV6') {
        params.push(['Device.IP.Interface.1.IPv6Enable', 'true', 'xsd:boolean']);
        if (config.wanStaticIpv6) {
          params.push(['Device.IP.Interface.1.IPv6Address.1.IPAddress', config.wanStaticIpv6, 'xsd:string']);
          params.push(['Device.IP.Interface.1.IPv6Address.1.Enable', 'true', 'xsd:boolean']);
        }
        if (config.wanStaticIpv6PrefixLen) {
          params.push(['Device.IP.Interface.1.IPv6Prefix.1.Prefix', `/${config.wanStaticIpv6PrefixLen}`, 'xsd:string']);
        }
        if (config.wanStaticIpv6Gw) {
          params.push(['Device.Routing.Router.1.IPv6Forwarding.1.NextHop', config.wanStaticIpv6Gw, 'xsd:string']);
        }
      }
      if (config.serviceVlan) {
        params.push(['Device.Ethernet.VLANTermination.1.VLANID', String(config.serviceVlan), 'xsd:unsignedInt']);
      }
    } else if (config.wanMode === 'DHCP') {
      params.push(['Device.IP.Interface.1.Enable', 'true', 'xsd:boolean']);
      params.push(['Device.IP.Interface.1.IPv4Address.1.AddressingType', 'DHCP', 'xsd:string']);
      if (config.ipProtocol === 'DUAL' || config.ipProtocol === 'IPV6') {
        params.push(['Device.IP.Interface.1.IPv6Enable', 'true', 'xsd:boolean']);
        params.push(['Device.DHCPv6.Client.1.Enable', 'true', 'xsd:boolean']);
      }
      if (config.serviceVlan) {
        params.push(['Device.Ethernet.VLANTermination.1.VLANID', String(config.serviceVlan), 'xsd:unsignedInt']);
      }
    }

    // 3. WiFi
    if (config.wifi) {
      if (config.wifi.ssid) {
        params.push(['Device.WiFi.SSID.1.SSID', config.wifi.ssid, 'xsd:string']);
        params.push(['Device.WiFi.SSID.1.Enable', 'true', 'xsd:boolean']);
        if (config.wifi.password) {
          params.push(['Device.WiFi.AccessPoint.1.Security.KeyPassphrase', config.wifi.password, 'xsd:string']);
          params.push(['Device.WiFi.AccessPoint.1.Security.ModeEnabled', 'WPA2-Personal', 'xsd:string']);
        }
      }
      if (config.wifi.ssid5g) {
        params.push(['Device.WiFi.SSID.2.SSID', config.wifi.ssid5g, 'xsd:string']);
        params.push(['Device.WiFi.SSID.2.Enable', 'true', 'xsd:boolean']);
        if (config.wifi.password) {
          params.push(['Device.WiFi.AccessPoint.2.Security.KeyPassphrase', config.wifi.password, 'xsd:string']);
          params.push(['Device.WiFi.AccessPoint.2.Security.ModeEnabled', 'WPA2-Personal', 'xsd:string']);
        }
      }
    }
  }

  private buildTR098Params(
    config: CpeConfigurationInput,
    params: Array<[string, string, string]>,
    vendorUpper: string,
  ): void {
    // 1. ManagementServer
    if (config.managementServer) {
      const ms = config.managementServer;
      params.push(['InternetGatewayDevice.ManagementServer.URL', ms.acsUrl, 'xsd:string']);
      if (ms.acsUsername) {
        params.push(['InternetGatewayDevice.ManagementServer.Username', ms.acsUsername, 'xsd:string']);
      }
      if (ms.acsPassword) {
        params.push(['InternetGatewayDevice.ManagementServer.Password', ms.acsPassword, 'xsd:string']);
      }
      if (ms.connReqUsername) {
        params.push(['InternetGatewayDevice.ManagementServer.ConnectionRequestUsername', ms.connReqUsername, 'xsd:string']);
      }
      if (ms.connReqPassword) {
        params.push(['InternetGatewayDevice.ManagementServer.ConnectionRequestPassword', ms.connReqPassword, 'xsd:string']);
      }
      const interval = ms.informIntervalSec ?? 300;
      params.push(['InternetGatewayDevice.ManagementServer.PeriodicInformInterval', String(interval), 'xsd:unsignedInt']);
      params.push(['InternetGatewayDevice.ManagementServer.PeriodicInformEnable', 'true', 'xsd:boolean']);
    }

    // 2. WAN & PPP (Ruta común TR-098 IGD)
    const pppBase = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
    const ipBase = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1';

    if (config.wanMode === 'PPPOE') {
      params.push([`${pppBase}.Enable`, 'true', 'xsd:boolean']);
      params.push([`${pppBase}.ConnectionType`, 'IP_Routed', 'xsd:string']);
      if (config.pppoeUsername) {
        params.push([`${pppBase}.Username`, config.pppoeUsername, 'xsd:string']);
      }
      if (config.pppoePassword) {
        params.push([`${pppBase}.Password`, config.pppoePassword, 'xsd:string']);
      }
      // Manejo de VLAN por fabricante TR-098
      if (config.serviceVlan) {
        if (vendorUpper.includes('ZTE')) {
          params.push([`${pppBase}.X_ZTE-COM_VLAN`, String(config.serviceVlan), 'xsd:unsignedInt']);
        } else if (vendorUpper.includes('HUAWEI')) {
          params.push([`${pppBase}.X_HW_VLAN`, String(config.serviceVlan), 'xsd:unsignedInt']);
        } else {
          // Broadcom standard extension
          params.push([`${pppBase}.X_BROADCOM_COM_VLANID`, String(config.serviceVlan), 'xsd:int']);
        }
      }
      if (config.ipProtocol === 'DUAL') {
        params.push([`${pppBase}.X_BROADCOM_COM_IPv6PrefixDelegationEnabled`, 'true', 'xsd:boolean']);
      }
      this.pushDnsOverrideParams(params, pppBase, config);
      this.pushPortBindingParams(params, pppBase, vendorUpper);
    } else if (config.wanMode === 'STATIC') {
      params.push([`${ipBase}.Enable`, 'true', 'xsd:boolean']);
      params.push([`${ipBase}.ConnectionType`, 'IP_Routed', 'xsd:string']);
      params.push([`${ipBase}.AddressingType`, 'Static', 'xsd:string']);
      if (config.wanStaticIp) {
        params.push([`${ipBase}.ExternalIPAddress`, config.wanStaticIp, 'xsd:string']);
      }
      if (config.wanStaticMask) {
        params.push([`${ipBase}.SubnetMask`, config.wanStaticMask, 'xsd:string']);
      }
      if (config.wanStaticGw) {
        params.push([`${ipBase}.DefaultGateway`, config.wanStaticGw, 'xsd:string']);
      }
      if (config.ipProtocol === 'DUAL' || config.ipProtocol === 'IPV6') {
        if (vendorUpper.includes('ZTE')) {
          params.push([`${ipBase}.X_ZTE-COM_IPv6Enable`, 'true', 'xsd:boolean']);
          if (config.wanStaticIpv6) {
            params.push([`${ipBase}.X_ZTE-COM_IPv6Address`, config.wanStaticIpv6, 'xsd:string']);
          }
        } else if (vendorUpper.includes('HUAWEI') || vendorUpper.includes('CMDC')) {
          params.push([`${ipBase}.X_HW_IPv6Enable`, 'true', 'xsd:boolean']);
          if (config.wanStaticIpv6) {
            params.push([`${ipBase}.X_HW_IPv6Address`, config.wanStaticIpv6, 'xsd:string']);
          }
        } else {
          params.push([`${ipBase}.X_BROADCOM_COM_IPv6Enable`, 'true', 'xsd:boolean']);
        }
      }
      if (config.serviceVlan) {
        if (vendorUpper.includes('ZTE')) {
          params.push([`${ipBase}.X_ZTE-COM_VLAN`, String(config.serviceVlan), 'xsd:unsignedInt']);
        } else if (vendorUpper.includes('HUAWEI')) {
          params.push([`${ipBase}.X_HW_VLAN`, String(config.serviceVlan), 'xsd:unsignedInt']);
        }
      }
      this.pushDnsOverrideParams(params, ipBase, config);
      this.pushPortBindingParams(params, ipBase, vendorUpper);
    } else if (config.wanMode === 'DHCP') {
      params.push([`${ipBase}.Enable`, 'true', 'xsd:boolean']);
      params.push([`${ipBase}.ConnectionType`, 'IP_Routed', 'xsd:string']);
      params.push([`${ipBase}.AddressingType`, 'DHCP', 'xsd:string']);
      if (config.ipProtocol === 'DUAL' || config.ipProtocol === 'IPV6') {
        if (vendorUpper.includes('ZTE')) {
          params.push([`${ipBase}.X_ZTE-COM_IPv6Enable`, 'true', 'xsd:boolean']);
          params.push([`${ipBase}.X_ZTE-COM_IPv6AddressingType`, 'DHCPv6', 'xsd:string']);
        } else if (vendorUpper.includes('HUAWEI') || vendorUpper.includes('CMDC')) {
          params.push([`${ipBase}.X_HW_IPv6Enable`, 'true', 'xsd:boolean']);
        } else {
          params.push([`${ipBase}.X_BROADCOM_COM_IPv6Enable`, 'true', 'xsd:boolean']);
        }
      }
      if (config.serviceVlan) {
        if (vendorUpper.includes('ZTE')) {
          params.push([`${ipBase}.X_ZTE-COM_VLAN`, String(config.serviceVlan), 'xsd:unsignedInt']);
        } else if (vendorUpper.includes('HUAWEI')) {
          params.push([`${ipBase}.X_HW_VLAN`, String(config.serviceVlan), 'xsd:unsignedInt']);
        }
      }
      this.pushPortBindingParams(params, ipBase, vendorUpper);
    }

    // 3. WiFi
    if (config.wifi) {
      if (config.wifi.ssid) {
        params.push(['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID', config.wifi.ssid, 'xsd:string']);
        params.push(['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable', 'true', 'xsd:boolean']);
        if (config.wifi.password) {
          params.push(['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase', config.wifi.password, 'xsd:string']);
          params.push(['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BeaconType', '11i', 'xsd:string']);
          params.push(['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.IEEE11iEncryptionModes', 'AESEncryption', 'xsd:string']);
        }
      }
      if (config.wifi.ssid5g) {
        params.push(['InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID', config.wifi.ssid5g, 'xsd:string']);
        params.push(['InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Enable', 'true', 'xsd:boolean']);
        if (config.wifi.password) {
          params.push(['InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.KeyPassphrase', config.wifi.password, 'xsd:string']);
          params.push(['InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.BeaconType', '11i', 'xsd:string']);
          params.push(['InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.IEEE11iEncryptionModes', 'AESEncryption', 'xsd:string']);
        }
      }
    }
  }

  /**
   * Vincula los puertos Ethernet LAN 1-4 y las interfaces WLAN 1-2 a la conexión WAN
   * en equipos con firmware CMCC / China Mobile / Huawei / ZTE (Port Binding).
   */
  private pushPortBindingParams(
    params: Array<[string, string, string]>,
    base: string,
    vendorUpper: string,
  ): void {
    if (
      !vendorUpper ||
      vendorUpper.includes('CMDC') ||
      vendorUpper.includes('CMCC') ||
      vendorUpper.includes('HUAWEI') ||
      vendorUpper.includes('ZTE')
    ) {
      params.push([`${base}.X_CMCC_LanInterface`, DEFAULT_TR098_LAN_WLAN_BINDING, 'xsd:string']);
    }
  }

  /**
   * DNS manual (override) para TR-098 -- confirmado en vivo (2026-10-22,
   * CMDCDD4D131E) que tanto WANPPPConnection como WANIPConnection exponen
   * "DNSServers" (string separado por coma) y "DNSOverrideAllowed" como
   * parámetros reales y escribibles en este firmware. Sin `dns1`, no se
   * manda nada -- se deja que el ISP/PPPoE entregue el DNS normalmente.
   */
  private pushDnsOverrideParams(
    params: Array<[string, string, string]>,
    base: string,
    config: CpeConfigurationInput,
  ): void {
    if (!config.dns1) return;
    const servers = [config.dns1, config.dns2].filter(Boolean).join(',');
    params.push([`${base}.DNSOverrideAllowed`, 'true', 'xsd:boolean']);
    params.push([`${base}.DNSEnabled`, 'true', 'xsd:boolean']);
    params.push([`${base}.DNSServers`, servers, 'xsd:string']);
  }
}
