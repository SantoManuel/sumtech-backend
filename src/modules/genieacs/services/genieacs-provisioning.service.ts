import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GenieAcsClient } from '../genieacs-client';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { GenieAcsDeviceResolverService } from '../genieacs-device-resolver.service';
import { GenieAcsDeviceEntity } from '../entities/genieacs-device.entity';
import { GenieAcsAuditLogEntity } from '../entities/genieacs-audit-log.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { PlanEntity } from '../../plans/entities/plan.entity';

export interface ProvisioningOperationResult {
  success: boolean;
  deviceId?: string | null;
  contractId?: string | null;
  reason?: string;
}

@Injectable()
export class GenieAcsProvisioningService {
  private readonly logger = new Logger(GenieAcsProvisioningService.name);

  constructor(
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
    private readonly deviceResolver: GenieAcsDeviceResolverService,
    @InjectRepository(GenieAcsDeviceEntity)
    private readonly deviceRepository: Repository<GenieAcsDeviceEntity>,
    @InjectRepository(GenieAcsAuditLogEntity)
    private readonly auditRepository: Repository<GenieAcsAuditLogEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(PlanEntity)
    private readonly planRepository: Repository<PlanEntity>,
  ) {}

  /**
   * Caso 1: Alta de nuevo cliente en GenieACS.
   * Asigna los tags 'CLI:<clienteId>' y 'PLAN:<planId>' y refresca el equipo vía TR-069.
   */
  async assignCustomerPlan(
    contractIdOrDeviceId: string,
    clientId?: string,
    planId?: string,
  ): Promise<ProvisioningOperationResult> {
    const { deviceId, contractId } = await this.resolveDeviceId(contractIdOrDeviceId);

    if (!deviceId) {
      this.logger.warn(
        `[GenieAcsProvisioning] No hay CPE GenieACS resuelto para '${contractIdOrDeviceId}'. Omitiendo asignación de tags.`,
      );
      return { success: false, contractId, reason: 'NO_DEVICE_RESOLVED' };
    }

    if (!this.client) {
      this.logger.warn('[GenieAcsProvisioning] Cliente GenieACS no configurado en entorno.');
      return { success: false, deviceId, contractId, reason: 'GENIEACS_NOT_CONFIGURED' };
    }

    // Si falta clientId o planId, intentamos obtenerlos del contrato
    let resolvedClientId = clientId;
    let resolvedPlanTag = this.normalizePlanTag(planId);

    if ((!resolvedClientId || !resolvedPlanTag) && contractId) {
      const contract = await this.contractRepository.findOne({
        where: { id: contractId },
        relations: ['plan'],
      });
      if (contract) {
        resolvedClientId = resolvedClientId || contract.clientId;
        if (!resolvedPlanTag) {
          resolvedPlanTag = this.resolvePlanTagFromEntity(contract.plan, contract.planId);
        }
      }
    }

    resolvedClientId = resolvedClientId || 'UNKNOWN';
    resolvedPlanTag = resolvedPlanTag || 'plan-100';

    this.logger.log(
      `[GenieAcsProvisioning] Asignando tags a dispositivo ${deviceId}: CLI:${resolvedClientId}, PLAN:${resolvedPlanTag}`,
    );

    try {
      await this.client.setDeviceTag(deviceId, `CLI:${resolvedClientId}`);
      await this.client.setDeviceTag(deviceId, `PLAN:${resolvedPlanTag}`);
      await this.client.refreshObject(deviceId);

      await this.auditRepository.save({
        contractId: contractId || null,
        genieacsDeviceId: deviceId,
        action: 'TR069_PARAMETER_CHANGE',
        actor: 'ERP',
        result: 'OK',
        parameterPath: 'Tags',
        newValue: `CLI:${resolvedClientId}, PLAN:${resolvedPlanTag}`,
      });

      return { success: true, deviceId, contractId };
    } catch (error: any) {
      this.logger.error(
        `[GenieAcsProvisioning] Error asignando plan al dispositivo ${deviceId}: ${error.message}`,
        error.stack,
      );

      await this.auditRepository.save({
        contractId: contractId || null,
        genieacsDeviceId: deviceId,
        action: 'TR069_PARAMETER_CHANGE',
        actor: 'ERP',
        result: 'ERROR',
        errorMessage: error.message,
        parameterPath: 'Tags',
      });

      return { success: false, deviceId, contractId, reason: error.message };
    }
  }

  /**
   * Caso 2: Cambio de plan comercial (Upgrade / Downgrade de velocidad).
   * Remueve el tag del plan anterior, asigna el nuevo y envía Connection Request para refresco.
   */
  async changePlan(
    contractIdOrDeviceId: string,
    oldPlanId?: string | null,
    newPlanId?: string,
  ): Promise<ProvisioningOperationResult> {
    const { deviceId, contractId } = await this.resolveDeviceId(contractIdOrDeviceId);

    if (!deviceId) {
      this.logger.warn(
        `[GenieAcsProvisioning] No hay CPE GenieACS resuelto para '${contractIdOrDeviceId}'. Omitiendo cambio de plan.`,
      );
      return { success: false, contractId, reason: 'NO_DEVICE_RESOLVED' };
    }

    if (!this.client) {
      this.logger.warn('[GenieAcsProvisioning] Cliente GenieACS no configurado en entorno.');
      return { success: false, deviceId, contractId, reason: 'GENIEACS_NOT_CONFIGURED' };
    }

    // Resolver nuevo tag de plan
    let targetNewPlanTag = this.normalizePlanTag(newPlanId);
    if (!targetNewPlanTag && contractId) {
      const contract = await this.contractRepository.findOne({
        where: { id: contractId },
        relations: ['plan'],
      });
      if (contract) {
        targetNewPlanTag = this.resolvePlanTagFromEntity(contract.plan, contract.planId);
      }
    }
    targetNewPlanTag = targetNewPlanTag || 'plan-100';

    const targetOldPlanTag = oldPlanId ? this.normalizePlanTag(oldPlanId) : null;

    this.logger.log(
      `[GenieAcsProvisioning] Cambiando plan en dispositivo ${deviceId}: antiguo='${targetOldPlanTag || 'N/A'}' -> nuevo='${targetNewPlanTag}'`,
    );

    try {
      // 1. Eliminar tag anterior específico si se indicó
      if (targetOldPlanTag) {
        await this.client.deleteDeviceTag(deviceId, `PLAN:${targetOldPlanTag}`).catch(() => {});
      }

      // 2. Limpieza de cualquier tag PLAN:* residual que no coincida con el nuevo
      try {
        const deviceStatus = await this.client.getDeviceStatus(deviceId);
        if (Array.isArray(deviceStatus?.tags)) {
          for (const tag of deviceStatus.tags) {
            if (tag.startsWith('PLAN:') && tag !== `PLAN:${targetNewPlanTag}`) {
              await this.client.deleteDeviceTag(deviceId, tag).catch(() => {});
            }
          }
        }
      } catch (cleanErr: any) {
        this.logger.warn(
          `[GenieAcsProvisioning] Advertencia leyendo tags previos de ${deviceId}: ${cleanErr.message}`,
        );
      }

      // 3. Asignar nuevo tag de plan
      await this.client.setDeviceTag(deviceId, `PLAN:${targetNewPlanTag}`);

      // 4. Solicitar refreshObject con connection_request=true
      await this.client.refreshObject(deviceId);

      await this.auditRepository.save({
        contractId: contractId || null,
        genieacsDeviceId: deviceId,
        action: 'TR069_PARAMETER_CHANGE',
        actor: 'ERP',
        result: 'OK',
        parameterPath: 'Tags.PLAN',
        oldValue: targetOldPlanTag ? `PLAN:${targetOldPlanTag}` : null,
        newValue: `PLAN:${targetNewPlanTag}`,
      });

      return { success: true, deviceId, contractId };
    } catch (error: any) {
      this.logger.error(
        `[GenieAcsProvisioning] Error cambiando plan en dispositivo ${deviceId}: ${error.message}`,
        error.stack,
      );

      await this.auditRepository.save({
        contractId: contractId || null,
        genieacsDeviceId: deviceId,
        action: 'TR069_PARAMETER_CHANGE',
        actor: 'ERP',
        result: 'ERROR',
        errorMessage: error.message,
        parameterPath: 'Tags.PLAN',
      });

      return { success: false, deviceId, contractId, reason: error.message };
    }
  }

  /**
   * Caso 3: Suspensión por impago (Corte Lógico vía Preset 07_suspension).
   * Asigna el tag 'STATUS:SUSPENDIDO' y refresca el equipo para aplicar portal cautivo / velocidad restringida.
   */
  async suspendService(contractIdOrDeviceId: string): Promise<ProvisioningOperationResult> {
    const { deviceId, contractId } = await this.resolveDeviceId(contractIdOrDeviceId);

    if (!deviceId) {
      this.logger.warn(
        `[GenieAcsProvisioning] No hay CPE GenieACS resuelto para '${contractIdOrDeviceId}'. Omitiendo suspensión TR-069.`,
      );
      return { success: false, contractId, reason: 'NO_DEVICE_RESOLVED' };
    }

    if (!this.client) {
      this.logger.warn('[GenieAcsProvisioning] Cliente GenieACS no configurado en entorno.');
      return { success: false, deviceId, contractId, reason: 'GENIEACS_NOT_CONFIGURED' };
    }

    this.logger.log(`[GenieAcsProvisioning] Suspendiendo servicio en dispositivo ${deviceId} vía tag STATUS:SUSPENDIDO`);

    try {
      await this.client.setDeviceTag(deviceId, 'STATUS:SUSPENDIDO');
      await this.client.refreshObject(deviceId);

      await this.auditRepository.save({
        contractId: contractId || null,
        genieacsDeviceId: deviceId,
        action: 'TR069_PARAMETER_CHANGE',
        actor: 'ERP',
        result: 'OK',
        parameterPath: 'Tags.STATUS',
        newValue: 'STATUS:SUSPENDIDO',
      });

      return { success: true, deviceId, contractId };
    } catch (error: any) {
      this.logger.error(
        `[GenieAcsProvisioning] Error suspendiendo servicio en dispositivo ${deviceId}: ${error.message}`,
        error.stack,
      );

      await this.auditRepository.save({
        contractId: contractId || null,
        genieacsDeviceId: deviceId,
        action: 'TR069_PARAMETER_CHANGE',
        actor: 'ERP',
        result: 'ERROR',
        errorMessage: error.message,
        parameterPath: 'Tags.STATUS',
      });

      return { success: false, deviceId, contractId, reason: error.message };
    }
  }

  /**
   * Caso 3b: Reactivación tras pago.
   * Remueve el tag 'STATUS:SUSPENDIDO' y refresca el equipo para restaurar el plan original.
   */
  async reactivateService(contractIdOrDeviceId: string): Promise<ProvisioningOperationResult> {
    const { deviceId, contractId } = await this.resolveDeviceId(contractIdOrDeviceId);

    if (!deviceId) {
      this.logger.warn(
        `[GenieAcsProvisioning] No hay CPE GenieACS resuelto para '${contractIdOrDeviceId}'. Omitiendo reactivación TR-069.`,
      );
      return { success: false, contractId, reason: 'NO_DEVICE_RESOLVED' };
    }

    if (!this.client) {
      this.logger.warn('[GenieAcsProvisioning] Cliente GenieACS no configurado en entorno.');
      return { success: false, deviceId, contractId, reason: 'GENIEACS_NOT_CONFIGURED' };
    }

    this.logger.log(`[GenieAcsProvisioning] Reactivando servicio en dispositivo ${deviceId}: eliminando STATUS:SUSPENDIDO`);

    try {
      await this.client.deleteDeviceTag(deviceId, 'STATUS:SUSPENDIDO');
      await this.client.refreshObject(deviceId);

      await this.auditRepository.save({
        contractId: contractId || null,
        genieacsDeviceId: deviceId,
        action: 'TR069_PARAMETER_CHANGE',
        actor: 'ERP',
        result: 'OK',
        parameterPath: 'Tags.STATUS',
        oldValue: 'STATUS:SUSPENDIDO',
        newValue: null,
      });

      return { success: true, deviceId, contractId };
    } catch (error: any) {
      this.logger.error(
        `[GenieAcsProvisioning] Error reactivando servicio en dispositivo ${deviceId}: ${error.message}`,
        error.stack,
      );

      await this.auditRepository.save({
        contractId: contractId || null,
        genieacsDeviceId: deviceId,
        action: 'TR069_PARAMETER_CHANGE',
        actor: 'ERP',
        result: 'ERROR',
        errorMessage: error.message,
        parameterPath: 'Tags.STATUS',
      });

      return { success: false, deviceId, contractId, reason: error.message };
    }
  }

  /**
   * Resuelve el identificador de dispositivo en GenieACS a partir de un contractId o deviceId.
   */
  private async resolveDeviceId(
    contractIdOrDeviceId: string,
  ): Promise<{ deviceId: string | null; contractId: string | null }> {
    // Si parece un deviceId directo de GenieACS (contiene guiones y OUI, ej: 00259E-... o 987DDD-...)
    if (/^[0-9A-Fa-f]{6}-/.test(contractIdOrDeviceId)) {
      const deviceRecord = await this.deviceRepository.findOne({
        where: [
          { genieacsDeviceId: contractIdOrDeviceId },
          { genieacsDeviceId: decodeURIComponent(contractIdOrDeviceId) },
        ],
      });
      return {
        deviceId: contractIdOrDeviceId,
        contractId: deviceRecord?.contractId || null,
      };
    }

    // De lo contrario se trata de un contractId (UUID)
    const contractId = contractIdOrDeviceId;
    const deviceRecord = await this.deviceResolver.resolveForContract(contractId);
    return {
      deviceId: deviceRecord?.genieacsDeviceId || null,
      contractId,
    };
  }

  /**
   * Normaliza una clave o identificador de plan al formato de tag de GenieACS (ej. 'plan-100', 'plan-200').
   */
  private normalizePlanTag(planIdOrTag?: string | null): string | null {
    if (!planIdOrTag) return null;
    let clean = planIdOrTag.trim();
    if (clean.toUpperCase().startsWith('PLAN:')) {
      clean = clean.substring(5).trim();
    }
    return clean;
  }

  /**
   * Mapea un PlanEntity al identificador de plan soportado por los presets de GenieACS.
   */
  private resolvePlanTagFromEntity(plan?: PlanEntity | null, fallbackPlanId?: string): string {
    if (!plan) {
      return fallbackPlanId ? `plan-${fallbackPlanId}` : 'plan-100';
    }

    if (plan.serviceType === 'TV') {
      return plan.tvChannelsCount > 100 ? 'tv-premium' : 'tv-basico';
    }

    if (plan.serviceType === 'DUAL') {
      return 'pack-duo';
    }

    if (plan.speedMbps === 100) return 'plan-100';
    if (plan.speedMbps === 200) return 'plan-200';
    if (plan.speedMbps === 300) return 'plan-300';

    if (plan.speedMbps && plan.speedMbps > 0) {
      return `plan-${plan.speedMbps}`;
    }

    // Si el nombre contiene 100, 200 o 300
    const match = plan.name?.match(/(\d+)\s*(?:Mbps|M|Megas)/i);
    if (match) {
      return `plan-${match[1]}`;
    }

    return `plan-${plan.id}`;
  }
}

