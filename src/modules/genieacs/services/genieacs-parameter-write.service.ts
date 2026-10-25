import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { GenieAcsClient } from '../genieacs-client';
import { GenieAcsAuditLogEntity } from '../entities/genieacs-audit-log.entity';

/** Rutas TR-069 que nunca deben quedar en texto plano en la auditoría -- ni el valor viejo ni el nuevo. */
const SENSITIVE_PATH_PATTERN = /\.(Password|KeyPassphrase|PreSharedKey)(\.|$)/i;
const REDACTED = '***';

export interface ParameterChange {
  path: string;
  value: string;
  type: string;
}

export interface ParameterWriteContext {
  actor: string;
  action: GenieAcsAuditLogEntity['action'];
  contractId?: string | null;
}

/**
 * Helper compartido por toda sección editable de la pestaña TR-069 (PPP,
 * WiFi avanzado, LAN DHCP Server, LAN Ports, Port Forward, ...) --
 * centraliza el patrón ya probado en `setWifiCredentials`
 * (`GenieAcsClient.setParameterValues` + verificación real de fault) y le
 * agrega auditoría genérica por parámetro (ver migración 095 y
 * Plan_Implementacion_Pestana_TR069_Avanzada_ONU.md §4), con redacción
 * automática de cualquier campo de contraseña/PSK -- nunca se guarda un
 * secreto en texto plano en `net.genieacs_audit_log`.
 */
@Injectable()
export class GenieAcsParameterWriteService {
  constructor(
    @Optional()
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
    @InjectRepository(GenieAcsAuditLogEntity)
    private readonly auditRepository: Repository<GenieAcsAuditLogEntity>,
  ) {}

  private getClient(): GenieAcsClient {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'El servidor GenieACS no está configurado (falta GENIEACS_NBI_BASE_URL o GENIEACS_NBI_API_KEY).',
      );
    }
    return this.client;
  }

  /**
   * Lee el valor viejo de cada parámetro, aplica el cambio como un único
   * `SetParameterValues` (atómico -- o se aplican todos, o ninguno, igual que
   * documenta `GenieAcsClient.setWifiCredentials`), y audita cada parámetro
   * por separado (éxito o fault real). Si el equipo rechaza el cambio, el
   * error original se re-lanza tal cual para que el controller lo traduzca.
   */
  async applyParameterChanges(
    deviceId: string,
    changes: ParameterChange[],
    context: ParameterWriteContext,
  ): Promise<void> {
    if (changes.length === 0) {
      return;
    }
    const client = this.getClient();
    const oldValues = await client.getParameterValues(
      deviceId,
      changes.map((c) => c.path),
    );

    try {
      await client.setParameterValues(
        deviceId,
        changes.map((c): [string, string, string] => [c.path, c.value, c.type]),
      );
    } catch (error: any) {
      await this.logChanges(deviceId, changes, oldValues, context, 'ERROR', error?.message);
      throw error;
    }

    await this.logChanges(deviceId, changes, oldValues, context, 'OK');
  }

  /**
   * Auditoría "cruda" para acciones que no son un `SetParameterValues` sobre
   * un path existente (ej. `AddObject`/`DeleteObject` de Port Forward, que
   * crean/eliminan toda una instancia, no un valor) -- mismo esquema de
   * columnas, sin pasar por el flujo de lectura-de-valor-viejo.
   */
  async auditAction(
    deviceId: string,
    context: ParameterWriteContext,
    details: { parameterPath?: string; oldValue?: string; newValue?: string },
    result: 'OK' | 'ERROR',
    errorMessage?: string,
  ): Promise<void> {
    await this.auditRepository.save(
      this.auditRepository.create({
        contractId: context.contractId ?? null,
        genieacsDeviceId: deviceId,
        action: context.action,
        actor: context.actor,
        result,
        errorMessage,
        parameterPath: details.parameterPath,
        oldValue: details.oldValue,
        newValue: details.newValue,
      }),
    );
  }

  private async logChanges(
    deviceId: string,
    changes: ParameterChange[],
    oldValues: Record<string, string | undefined>,
    context: ParameterWriteContext,
    result: 'OK' | 'ERROR',
    errorMessage?: string,
  ): Promise<void> {
    const rows = changes.map((change) =>
      this.auditRepository.create({
        contractId: context.contractId ?? null,
        genieacsDeviceId: deviceId,
        action: context.action,
        actor: context.actor,
        result,
        errorMessage,
        parameterPath: change.path,
        oldValue: redactIfSensitive(change.path, oldValues[change.path]),
        newValue: redactIfSensitive(change.path, change.value),
      }),
    );
    await this.auditRepository.save(rows);
  }
}

function redactIfSensitive(path: string, value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return SENSITIVE_PATH_PATTERN.test(path) ? REDACTED : value;
}
