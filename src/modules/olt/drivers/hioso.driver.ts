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
export class HiosoDriver implements IOltDriver {
  private readonly logger = new Logger(HiosoDriver.name);

  async testConnection(params: OltConnectionParams): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    return { ok: true, latencyMs: 20 };
  }

  async getSystemInfo(params: OltConnectionParams): Promise<OltSystemInfo> {
    return {
      vendor: 'HIOSO',
      model: 'HA7304GP',
      uptime: '28 days, 04:10:00',
      firmwareVersion: 'V2.1.8',
    };
  }

  async discoverInterfaces(params: OltConnectionParams): Promise<DiscoveredInterface[]> {
    const ifaces: DiscoveredInterface[] = [];
    for (let p = 1; p <= 4; p++) {
      ifaces.push({
        name: `EPON0/${p}`,
        type: 'PON',
        slot: 0,
        port: p,
        adminState: 'UP',
        operState: 'UP',
        registeredOnus: 18,
      });
    }
    ifaces.push({
      name: 'G1',
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
    return { rxDbm: -20.5, txDbm: 2.4, attenuationDb: 22.9 };
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
      `onu add ${config.onuId} mac ${config.serialNumber}`,
      `onu ${config.onuId} vlan mode tag ${config.serviceVlan}`,
      'exit',
    ];
  }
}
