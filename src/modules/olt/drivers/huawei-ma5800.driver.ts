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
  OltDriverCapabilities,
  NO_DRIVER_CAPABILITIES,
  DriverNotImplementedError,
} from '../ports/olt-driver.port';

const VENDOR = 'HUAWEI';

/**
 * Driver registrado para Huawei MA5800 — ninguna operación tiene comunicación
 * real implementada todavía. No inventar comandos CLI sin evidencia real del
 * equipo (ver DriverNotImplementedError y getCapabilities()).
 */
@Injectable()
export class HuaweiMa5800Driver implements IOltDriver {
  private readonly logger = new Logger(HuaweiMa5800Driver.name);

  async testConnection(params: OltConnectionParams): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    return { ok: false, error: new DriverNotImplementedError(VENDOR, 'testConnection').message };
  }

  async getSystemInfo(params: OltConnectionParams): Promise<OltSystemInfo> {
    throw new DriverNotImplementedError(VENDOR, 'getSystemInfo');
  }

  async discoverInterfaces(params: OltConnectionParams): Promise<DiscoveredInterface[]> {
    throw new DriverNotImplementedError(VENDOR, 'discoverInterfaces');
  }

  async configureVlanOnInterface(params: OltConnectionParams, config: ConfigureVlanParams): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: new DriverNotImplementedError(VENDOR, 'configureVlanOnInterface').message };
  }

  async getUnconfiguredOnus(params: OltConnectionParams, ponInterface?: string): Promise<DiscoveredUncfgOnu[]> {
    throw new DriverNotImplementedError(VENDOR, 'getUnconfiguredOnus');
  }

  async getOnuOpticalPower(params: OltConnectionParams, onuTarget: string): Promise<OnuOpticalPower> {
    throw new DriverNotImplementedError(VENDOR, 'getOnuOpticalPower');
  }

  async authorizeOnu(params: OltConnectionParams, config: AuthorizeOnuParams): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: new DriverNotImplementedError(VENDOR, 'authorizeOnu').message };
  }

  async setOnuAdminState(params: OltConnectionParams, onuTarget: string, state: 'ACTIVE' | 'BLOCKED'): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: new DriverNotImplementedError(VENDOR, 'setOnuAdminState').message };
  }

  async deleteOnu(params: OltConnectionParams, ponInterface: string, onuId: number): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: new DriverNotImplementedError(VENDOR, 'deleteOnu').message };
  }

  generateAuthorizationScript(config: AuthorizeOnuParams): string[] {
    throw new DriverNotImplementedError(VENDOR, 'generateAuthorizationScript');
  }

  getCapabilities(): OltDriverCapabilities {
    return { ...NO_DRIVER_CAPABILITIES };
  }
}
