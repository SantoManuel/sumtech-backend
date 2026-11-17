import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';
import { TenantConnectionManagerService } from '../../../common/tenancy/tenant-connection-manager.service';
import { TenantEntity } from '../../platform/entities/tenant.entity';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { buildSerialCandidates, GenieAcsClient } from '../genieacs-client';
import { normalizeDeviceMac } from '../utils/device-mac';
import { CpeWanPolicyService } from './cpe-wan-policy.service';

export interface VerifiedOnuIdentity {
  deviceId: string;
  method: 'SERIAL' | 'MAC';
  tr069SerialNumber?: string;
  managementMac?: string;
}

@Injectable()
export class OnuGenieacsIdentityService implements OnModuleInit {
  constructor(
    @Inject(GENIEACS_CLIENT) private readonly client: GenieAcsClient | null,
    private readonly tenant: TenantContextService,
    @InjectDataSource('platform') private readonly platform: DataSource,
    private readonly connections: TenantConnectionManagerService,
    private readonly policy: CpeWanPolicyService,
  ) {}

  onModuleInit(): void {
    this.policy.setIdentityVerifier(deviceId => this.verifyDeviceForWrite(deviceId));
  }

  async releaseDeletedOnu(onuId: string): Promise<void> {
    const remaining = await this.tenant.getDataSource().query('SELECT id FROM net.onus WHERE id=$1', [onuId]);
    if (remaining.length) throw new ConflictException('La ONU todavia existe; no se puede liberar su identidad.');
    await this.platform.query('DELETE FROM platform.genieacs_identity_claims WHERE tenant_id=$1 AND onu_id=$2', [this.tenant.getTenantId(), onuId]);
  }

  async recordManagementMac(onuId: string, value?: string): Promise<void> {
    const mac = normalizeDeviceMac(value);
    if (value && !mac) throw new ConflictException('La OLT no devolvio una MAC de gestion valida.');
    await this.tenant.getDataSource().query(
      `UPDATE net.onus SET management_mac=$2, management_mac_source='OLT_IPHOST_2',
       management_mac_observed_at=now(), genieacs_identity_verified_at=NULL WHERE id=$1`, [onuId, mac || null]);
  }

  async resolveSerial(serial: string): Promise<VerifiedOnuIdentity | null> {
    const rows = await this.tenant.getDataSource().query('SELECT id FROM net.onus WHERE serial_number=$1', [serial]);
    if (!rows.length) return null;
    if (rows.length !== 1) throw new ConflictException('El serial identifica varias ONUs del tenant.');
    return this.resolveOnu(rows[0].id);
  }

  async resolveContract(contractId: string): Promise<VerifiedOnuIdentity | null> {
    const rows = await this.tenant.getDataSource().query('SELECT id FROM net.onus WHERE contract_id=$1', [contractId]);
    if (!rows.length) return null;
    if (rows.length !== 1) throw new ConflictException('El contrato tiene varias ONUs; selecciona el equipo.');
    return this.resolveOnu(rows[0].id);
  }

  async verifyDeviceForWrite(deviceId: string, contractId?: string): Promise<void> {
    const rows = await this.tenant.getDataSource().query(
      'SELECT id,contract_id FROM net.onus WHERE genieacs_device_id=$1', [deviceId]);
    if (rows.length > 1) throw new ConflictException('El dispositivo esta vinculado a varias ONUs.');
    if (rows.length === 1) {
      if (contractId && rows[0].contract_id !== contractId) throw new ConflictException('El dispositivo no pertenece al contrato.');
      const identity = await this.resolveOnu(rows[0].id);
      if (identity?.deviceId !== deviceId) throw new ConflictException('No se pudo verificar la identidad del dispositivo.');
      return;
    }
    // Non-ONU inventory devices retain their contract flow, with explicit tenant ownership.
    if (!this.client) throw new ServiceUnavailableException('GenieACS no esta configurado.');
    const claimed = await this.platform.query('SELECT tenant_id FROM platform.genieacs_identity_claims WHERE device_id=$1', [deviceId]);
    if (claimed.length) throw new ConflictException('El dispositivo tiene una reserva de ONU sin una vinculacion local valida.');
    const doc = await this.client.getDeviceDocument(deviceId);
    const expected = `tenant:${this.tenant.getSlug().toLowerCase().trim()}`;
    const tags: string[] = doc?._tags || [];
    if (!tags.some(t => t.toLowerCase() === expected) || tags.some(t => /^tenant:/i.test(t) && t.toLowerCase() !== expected)) {
      throw new ConflictException('No se pudo confirmar la pertenencia del dispositivo al tenant.');
    }
  }

  async resolveOnu(onuId: string): Promise<VerifiedOnuIdentity | null> {
    if (!this.client) throw new ServiceUnavailableException('GenieACS no esta configurado.');
    const db = this.tenant.getDataSource();
    const [onu] = await db.query('SELECT * FROM net.onus WHERE id=$1', [onuId]);
    if (!onu) throw new NotFoundException('ONU no encontrada.');
    const mac = onu.management_mac_source === 'OLT_IPHOST_2' ? normalizeDeviceMac(onu.management_mac) : undefined;
    let serialId: string | null;
    let macId: string | null = null;
    try {
      serialId = await this.client.findDeviceBySerial(onu.serial_number, { exactOnly: true });
      if (mac) macId = await this.client.findDeviceByExactMac(mac);
    } catch (error: any) {
      if (/ambigua/i.test(error.message)) throw new ConflictException('Hay varias coincidencias de identidad en GenieACS.');
      throw new ServiceUnavailableException('No se pudo consultar la identidad en GenieACS.');
    }
    if (serialId && macId && serialId !== macId) throw new ConflictException('El serial y la MAC identifican dispositivos diferentes.');
    const deviceId = serialId || macId;
    if (!deviceId) {
      if (onu.genieacs_device_id) throw new ConflictException('La vinculacion existente ya no coincide con el serial ni la MAC de gestion.');
      return null;
    }
    if (onu.genieacs_device_id && onu.genieacs_device_id !== deviceId) throw new ConflictException('La identidad observada contradice la vinculacion existente.');
    let doc: any;
    try { doc = await this.client.getDeviceDocument(deviceId); }
    catch { throw new ServiceUnavailableException('No se pudo verificar el dispositivo en GenieACS.'); }
    if (!doc || doc._id !== deviceId) throw new ServiceUnavailableException('GenieACS no devolvio el dispositivo esperado.');
    const slug = this.tenant.getSlug().toLowerCase().trim();
    const tags: string[] = doc._tags || [];
    if (tags.some(t => /^tenant:/i.test(t) && t.toLowerCase() !== `tenant:${slug}`)) {
      throw new ConflictException('El dispositivo pertenece a otro tenant.');
    }
    const method = serialId ? 'SERIAL' : 'MAC';
    // Verify the document again: do not trust a stale search response.
    if (method === 'SERIAL' && !buildSerialCandidates(onu.serial_number).some(s =>
      s.toLowerCase() === String(doc._deviceId?._SerialNumber || '').toLowerCase() || deviceId.toLowerCase().endsWith(`-${s.toLowerCase()}`))) {
      throw new ConflictException('El dispositivo ya no corresponde al serial consultado.');
    }
    if (mac && !GenieAcsClient.documentHasExactMac(doc, mac)) throw new ConflictException('La MAC de gestion no coincide con el documento actual del dispositivo.');
    const runner = this.platform.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      await runner.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`genieacs:identity:${deviceId}`]);
      const claims = await runner.query('SELECT * FROM platform.genieacs_identity_claims WHERE device_id=$1 OR (tenant_id=$2 AND onu_id=$3) OR management_mac=$4 FOR UPDATE',
        [deviceId, this.tenant.getTenantId(), onuId, mac || null]);
      if (claims.some((c: any) => c.device_id !== deviceId || c.tenant_id !== this.tenant.getTenantId() || c.onu_id !== onuId)) {
        throw new ConflictException('El dispositivo o su MAC ya estan vinculados a otra ONU.');
      }
      // Existing deployments predate claims: inspect historical bindings before claiming.
      if (!claims.length) {
        const tenants = await this.platform.getRepository(TenantEntity).find();
        for (const other of tenants) {
          const source = other.id === this.tenant.getTenantId() ? db : await this.connections.getDataSourceForTenant(other);
          const occupied = await source.query(`SELECT o.id FROM net.onus o LEFT JOIN net.genieacs_devices d ON d.contract_id=o.contract_id
            WHERE (o.genieacs_device_id=$1 OR d.genieacs_device_id=$1) AND NOT ($2 AND o.id=$3)`,
            [deviceId, other.id === this.tenant.getTenantId(), onuId]);
          if (occupied.length) throw new ConflictException('Existe una vinculacion previa del dispositivo con otra ONU.');
          const contracts = await source.query(`SELECT id FROM net.genieacs_devices WHERE genieacs_device_id=$1
            AND NOT ($2 AND contract_id=$3)`, [deviceId, other.id === this.tenant.getTenantId(), onu.contract_id || '00000000-0000-0000-0000-000000000000']);
          if (contracts.length) throw new ConflictException('El dispositivo ya esta vinculado a otro contrato.');
        }
      }
      await runner.query(`INSERT INTO platform.genieacs_identity_claims(device_id,tenant_id,onu_id,management_mac,method)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(device_id) DO UPDATE SET management_mac=EXCLUDED.management_mac,method=EXCLUDED.method,verified_at=now()`,
        [deviceId, this.tenant.getTenantId(), onuId, mac || null, method]);
      if (!tags.some(t => t.toLowerCase() === `tenant:${slug}`)) await this.client.setDeviceTag(deviceId, `TENANT:${slug}`);
      const updated = await db.query(`WITH updated AS (
        UPDATE net.onus SET genieacs_device_id=$2,tr069_serial_number=$3,
          genieacs_link_method=$4,genieacs_identity_verified_at=now()
        WHERE id=$1 AND serial_number=$5 AND management_mac IS NOT DISTINCT FROM $6
          AND management_mac_source IS NOT DISTINCT FROM $7 RETURNING id
      ) SELECT id FROM updated`,
        [onuId, deviceId, doc._deviceId?._SerialNumber || null, method, onu.serial_number, onu.management_mac || null, onu.management_mac_source || null]);
      if (updated.length !== 1) throw new ConflictException('La identidad de la ONU cambio durante la verificacion. Reintenta la sincronizacion.');
      if (onu.genieacs_device_id !== deviceId || onu.genieacs_link_method !== method || onu.tr069_serial_number !== doc._deviceId?._SerialNumber || claims[0]?.management_mac !== mac) {
        await db.query(`INSERT INTO net.onu_genieacs_identity_events(onu_id,device_id,method,management_mac,tr069_serial_number)
          VALUES($1,$2,$3,$4,$5)`, [onuId, deviceId, method, mac || null, doc._deviceId?._SerialNumber || null]);
      }
      await runner.commitTransaction();
    } catch (error: any) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      if (error.code === '23505') throw new ConflictException('La identidad ya fue reservada por otra ONU.');
      if (error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException('No se pudo completar la verificacion de pertenencia del dispositivo. Revisa las migraciones y la conectividad.');
    } finally { await runner.release(); }
    return { deviceId, method, tr069SerialNumber: doc._deviceId?._SerialNumber, managementMac: mac };
  }
}
