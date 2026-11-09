import { ConflictException, Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';

export function isWanParameter(path: string): boolean {
  return /^(InternetGatewayDevice\.WANDevice\.|Device\.(PPP\.|IP\.|DHCPv[46]\.|Ethernet\.VLAN|Routing\.|NAT\.|DNS\.))/i.test(path);
}

/** Shared by all WAN writers; session advisory locks work across backend processes. */
@Injectable()
export class CpeWanPolicyService {
  private readonly held = new AsyncLocalStorage<Set<string>>();
  constructor(private readonly tenant: TenantContextService) {}

  bindResolvedDevice(deviceId: string): void {
    // Called only after findDeviceBySerial, inside the serial-bound writer lock.
    const store = this.held.getStore();
    if (store?.size) store.add(`device:${this.tenant.getTenantId()}:${deviceId}`);
  }

  async withManagedWrite<T>(onuId: string, method: 'OMCI' | 'TR069', version: number, action: () => Promise<T>): Promise<T> {
    return this.withOnu(onuId, async () => {
      const key = `managed:${this.tenant.getTenantId()}:${onuId}:${method}:${version}`;
      const store = new Set(this.held.getStore());
      store.add(key);
      return this.held.run(store, action);
    });
  }

  async withOnu<T>(onuId: string, action: () => Promise<T>): Promise<T> {
    const key = `${this.tenant.getTenantId()}:${onuId}`;
    if (this.held.getStore()?.has(key)) return action();
    const runner = this.tenant.getDataSource().createQueryRunner();
    let locked = false;
    try {
      await runner.connect();
      const rows = await runner.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [`sumtech:wan:${onuId}`]);
      locked = rows[0]?.locked === true;
      if (!locked) throw new ConflictException('Hay otra operación WAN en curso para esta ONU.');
      return await this.held.run(new Set([...(this.held.getStore() || []), key]), action);
    } finally {
      try {
        if (locked) await runner.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`sumtech:wan:${onuId}`]);
      } finally {
        await runner.release();
      }
    }
  }

  async withSerial<T>(serial: string, action: () => Promise<T>): Promise<T> {
    const rows = await this.tenant.getDataSource().query('SELECT id FROM net.onus WHERE serial_number = $1', [serial]);
    if (rows.length !== 1) throw new ConflictException('La escritura WAN requiere una única ONU vinculada en este tenant.');
    return this.withOnu(rows[0].id, async () => {
      await this.assertTr069Owner(rows[0].id);
      return action();
    });
  }

  async withDeviceWrite<T>(deviceId: string, paths: string[], action: () => Promise<T>): Promise<T> {
    if (!paths.some(isWanParameter)) return action();
    if (this.held.getStore()?.has(`device:${this.tenant.getTenantId()}:${deviceId}`)) return action();
    const rows = await this.tenant.getDataSource().query(
      `SELECT DISTINCT o.id FROM net.onus o
       LEFT JOIN net.genieacs_devices d ON d.contract_id = o.contract_id
       WHERE o.genieacs_device_id = $1 OR d.genieacs_device_id = $1`, [deviceId]);
    if (rows.length !== 1) throw new ConflictException('No se puede resolver una única ONU del tenant para escribir la WAN.');
    return this.withOnu(rows[0].id, async () => {
      await this.assertTr069Owner(rows[0].id);
      return action();
    });
  }

  /**
   * Solo bloquea la escritura directa cuando genuinamente contradice al
   * mecanismo que administra la WAN (OMCI, en el lado de la OLT). El
   * versionado TR-069 (`wan_desired_version`) es un historial de auditoría,
   * no un candado -- un operador puede corregir PPPoE/usuario/clave las veces
   * que haga falta sin esperar a que una operación previa "se confirme" (ver
   * `OnuWanProvisioningService.configure`, que ya trata cada envío como la
   * intención vigente y no como algo que deba resolverse antes de aceptar la
   * siguiente).
   */
  private async assertTr069Owner(onuId: string): Promise<void> {
    const rows = await this.tenant.getDataSource().query(
      'SELECT wan_provisioning_method, wan_applied_method FROM net.onu_service_config WHERE onu_id = $1', [onuId]);
    if (rows[0]?.wan_provisioning_method === 'OMCI' ||
        (!rows[0]?.wan_provisioning_method && rows[0]?.wan_applied_method === 'OMCI')) {
      throw new ConflictException('La WAN está administrada mediante OMCI. Usa Configurar WAN para cambiar de método.');
    }
  }
}
