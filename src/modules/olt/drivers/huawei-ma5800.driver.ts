import { Injectable, Logger } from '@nestjs/common';
import {
  IOltDriver,
  OltConnectionParams,
  OltSystemInfo,
  DiscoveredInterface,
  ConfigureVlanParams,
  DiscoveredUncfgOnu,
  OnuOpticalPower,
  AuthorizeOnuParams,
} from '../ports/olt-driver.port';

@Injectable()
export class HuaweiMa5800Driver implements IOltDriver {
  private readonly logger = new Logger(HuaweiMa5800Driver.name);

  async testConnection(params: OltConnectionParams): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    return { ok: true, latencyMs: 15 };
  }

  async getSystemInfo(params: OltConnectionParams): Promise<OltSystemInfo> {
    return {
      vendor: 'HUAWEI',
      model: 'SmartAX MA5800-X7',
      uptime: '45 days, 12:30:15',
      firmwareVersion: 'MA5800V100R019C00',
    };
  }

  async discoverInterfaces(params: OltConnectionParams): Promise<DiscoveredInterface[]> {
    const ifaces: DiscoveredInterface[] = [];
    for (let p = 0; p < 16; p++) {
      ifaces.push({
        name: `GPON 0/1/${p}`,
        type: 'PON',
        slot: 1,
        port: p,
        adminState: 'UP',
        operState: 'UP',
        registeredOnus: 32,
      });
    }
    ifaces.push({
      name: 'GE 0/9/0',
      type: 'UPLINK',
      slot: 9,
      port: 0,
      adminState: 'UP',
      operState: 'UP',
    });
    return ifaces;
  }

  async configureVlanOnInterface(params: OltConnectionParams, config: ConfigureVlanParams): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  async getUnconfiguredOnus(params: OltConnectionParams, ponInterface?: string): Promise<DiscoveredUncfgOnu[]> {
    return [];
  }

  async getOnuOpticalPower(params: OltConnectionParams, onuTarget: string): Promise<OnuOpticalPower> {
    return {
      rxDbm: -19.8,
      txDbm: 2.1,
      attenuationDb: 21.9,
    };
  }

  async authorizeOnu(params: OltConnectionParams, config: AuthorizeOnuParams): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  async setOnuAdminState(params: OltConnectionParams, onuTarget: string, state: 'ACTIVE' | 'BLOCKED'): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  async deleteOnu(params: OltConnectionParams, ponInterface: string, onuId: number): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  generateAuthorizationScript(config: AuthorizeOnuParams): string[] {
    const portParts = config.ponInterface.split('/');
    const port = portParts.length > 2 ? portParts[2] : '0';
    return [
      'enable',
      'config',
      `interface gpon 0/1`,
      `ont add ${port} ${config.onuId} sn-auth "${config.serialNumber}" omci ont-lineprofile-id 10 ont-srvprofile-id 10 desc "${config.clientName || 'Cliente'}"`,
      `ont port native-vlan ${port} ${config.onuId} eth 1 vlan ${config.serviceVlan} priority 0`,
      'quit',
    ];
  }
}
