import { Injectable } from '@nestjs/common';
import { IOltDriver, OltDriverCapabilities, NO_DRIVER_CAPABILITIES, UnknownOltVendorError } from '../ports/olt-driver.port';
import { ZteC320Driver } from './zte-c320.driver';
import { HuaweiMa5800Driver } from './huawei-ma5800.driver';
import { HiosoDriver } from './hioso.driver';
import { HsgqDriver } from './hsgq.driver';

@Injectable()
export class OltDriverRegistry {
  constructor(
    private readonly zteDriver: ZteC320Driver,
    private readonly huaweiDriver: HuaweiMa5800Driver,
    private readonly hiosoDriver: HiosoDriver,
    private readonly hsgqDriver: HsgqDriver,
  ) {}

  /**
   * Resuelve el driver real del fabricante. Nunca cae en ZteC320Driver por
   * defecto — un vendor vacío o no reconocido lanza UnknownOltVendorError en
   * vez de ejecutar silenciosamente comandos de otro fabricante.
   */
  resolve(vendorOrModel?: string): IOltDriver {
    const v = (vendorOrModel || '').toUpperCase().trim();
    if (!v) {
      throw new UnknownOltVendorError(vendorOrModel);
    }
    if (v.includes('ZTE')) {
      return this.zteDriver;
    }
    if (v.includes('HUAWEI')) {
      return this.huaweiDriver;
    }
    if (v.includes('HIOSO')) {
      return this.hiosoDriver;
    }
    if (v.includes('HSGQ')) {
      return this.hsgqDriver;
    }
    throw new UnknownOltVendorError(vendorOrModel);
  }

  /**
   * Lista las capacidades reales de cada fabricante registrado. Sin efectos
   * secundarios — getCapabilities() nunca intenta conectarse al equipo, solo
   * reporta qué operaciones tienen comunicación real implementada. Usado por
   * el frontend para mostrar qué tan soportado está cada fabricante antes de
   * que el usuario cree una OLT (ver GET /olt/vendors).
   */
  listAll(): Array<{ vendor: string; capabilities: OltDriverCapabilities }> {
    return [
      { vendor: 'ZTE', capabilities: this.zteDriver.getCapabilities() },
      { vendor: 'HUAWEI', capabilities: this.huaweiDriver.getCapabilities() },
      { vendor: 'HIOSO', capabilities: this.hiosoDriver.getCapabilities() },
      { vendor: 'HSGQ', capabilities: this.hsgqDriver.getCapabilities() },
    ];
  }

  /**
   * Adjunta las capacidades reales del fabricante a cualquier entidad con
   * `vendor` (OLT u ONU con su OLT embebida) — mismo criterio honesto que
   * `resolve()`: un vendor desconocido nunca hereda capacidades de otro
   * fabricante, cae en NO_DRIVER_CAPABILITIES (todo en false).
   */
  attachCapabilities<T extends { vendor: string }>(entity: T): T & { capabilities: OltDriverCapabilities } {
    let capabilities: OltDriverCapabilities;
    try {
      capabilities = this.resolve(entity.vendor).getCapabilities();
    } catch {
      capabilities = { ...NO_DRIVER_CAPABILITIES };
    }
    return Object.assign(entity, { capabilities });
  }
}
