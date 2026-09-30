import { Injectable } from '@nestjs/common';

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
  operationMode?: 'BRIDGE' | 'ROUTER';
  ipProtocol?: 'IPV4' | 'IPV6' | 'DUAL';
  wanMode?: 'STATIC' | 'DHCP' | 'PPPOE';
  serviceVlan?: number;
  // PPPoE
  pppoeUsername?: string;
  pppoePassword?: string;
  // Static IP
  wanStaticIp?: string;
  wanStaticMask?: string;
  wanStaticGw?: string;
  // Management Server
  managementServer?: CpeManagementServerConfig;
  // WiFi
  wifi?: {
    ssid?: string;
    password?: string;
    ssid5g?: string;
  };
}

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
   * Parámetros clave a verificar tras la aplicación para comprobar que el CPE los aceptó.
   */
  getVerificationParameters(config: CpeConfigurationInput, isTR181: boolean): string[] {
    const verification: string[] = [];
    if (isTR181) {
      if (config.wanMode === 'PPPOE') {
        verification.push('Device.PPP.Interface.1.Enable', 'Device.PPP.Interface.1.Username');
      } else if (config.wanMode === 'STATIC') {
        verification.push('Device.IP.Interface.1.IPv4Address.1.IPAddress');
      }
      if (config.managementServer?.acsUrl) {
        verification.push('Device.ManagementServer.URL');
      }
    } else {
      if (config.wanMode === 'PPPOE') {
        verification.push(
          'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Enable',
          'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
        );
      } else if (config.wanMode === 'STATIC') {
        verification.push(
          'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress',
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
      if (config.serviceVlan) {
        params.push(['Device.Ethernet.VLANTermination.1.VLANID', String(config.serviceVlan), 'xsd:unsignedInt']);
      }
    } else if (config.wanMode === 'DHCP') {
      params.push(['Device.IP.Interface.1.Enable', 'true', 'xsd:boolean']);
      params.push(['Device.IP.Interface.1.IPv4Address.1.AddressingType', 'DHCP', 'xsd:string']);
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
      if (config.serviceVlan) {
        if (vendorUpper.includes('ZTE')) {
          params.push([`${ipBase}.X_ZTE-COM_VLAN`, String(config.serviceVlan), 'xsd:unsignedInt']);
        } else if (vendorUpper.includes('HUAWEI')) {
          params.push([`${ipBase}.X_HW_VLAN`, String(config.serviceVlan), 'xsd:unsignedInt']);
        }
      }
    } else if (config.wanMode === 'DHCP') {
      params.push([`${ipBase}.Enable`, 'true', 'xsd:boolean']);
      params.push([`${ipBase}.ConnectionType`, 'IP_Routed', 'xsd:string']);
      params.push([`${ipBase}.AddressingType`, 'DHCP', 'xsd:string']);
      if (config.serviceVlan) {
        if (vendorUpper.includes('ZTE')) {
          params.push([`${ipBase}.X_ZTE-COM_VLAN`, String(config.serviceVlan), 'xsd:unsignedInt']);
        } else if (vendorUpper.includes('HUAWEI')) {
          params.push([`${ipBase}.X_HW_VLAN`, String(config.serviceVlan), 'xsd:unsignedInt']);
        }
      }
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
}
