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
export class HsgqDriver implements IOltDriver {
  private readonly logger = new Logger(HsgqDriver.name);

  async testConnection(params: OltConnectionParams): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    return { ok: true, latencyMs: 18 };
  }

  async getSystemInfo(params: OltConnectionParams): Promise<OltSystemInfo> {
    return {
      vendor: 'HSGQ',
      model: 'HSGQ-G08',
      uptime: '15 days, 08:20:00',
      firmwareVersion: 'HSGQ-OS-V3.4',
    };
  }

  async discoverInterfaces(params: OltConnectionParams): Promise<DiscoveredInterface[]> {
    const ifaces: DiscoveredInterface[] = [];
    for (let p = 1; p <= 8; p++) {
      ifaces.push({
        name: `EPON0/${p}`,
        type: 'PON',
        slot: 0,
        port: p,
        adminState: 'UP',
        operState: 'UP',
        registeredOnus: 24,
      });
    }
    ifaces.push({
      name: 'GE0/1',
      type: 'UPLINK',
      slot: 0,
      port: 1,
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
    return { rxDbm: -21.0, txDbm: 2.2, attenuationDb: 23.2 };
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
    return [
      `interface ${config.ponInterface}`,
      `ont add ${config.onuId} sn-auth ${config.serialNumber}`,
      `ont port vlan ${config.onuId} 1 ${config.serviceVlan}`,
      'exit',
    ];
  }
}
