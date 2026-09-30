import { Injectable } from '@nestjs/common';
import { IOltDriver } from '../ports/olt-driver.port';
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

  resolve(vendorOrModel?: string): IOltDriver {
    const v = (vendorOrModel || '').toUpperCase();
    if (v.includes('HUAWEI')) {
      return this.huaweiDriver;
    }
    if (v.includes('HIOSO')) {
      return this.hiosoDriver;
    }
    if (v.includes('HSGQ')) {
      return this.hsgqDriver;
    }
    // Default: ZTE C320
    return this.zteDriver;
  }
}
