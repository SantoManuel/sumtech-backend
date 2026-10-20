import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnuEntity } from '../entities/onu.entity';
import { OnuManagementService } from './onu-management.service';
import { TenantIteratorService } from '../../../common/tenancy/tenant-iterator.service';
import { GENIEACS_CLIENT } from '../../genieacs/genieacs-client-factory';
import { GenieAcsClient } from '../../genieacs/genieacs-client';

export interface CpeSyncRetryResult {
  checked: number;
  succeeded: number;
  failed: number;
}

/**
 * Reintenta automáticamente el push a GenieACS (WAN/PPPoE/WiFi + tags
 * TENANT/OLT, ver `OnuManagementService.pushCpeConfiguration`) para cualquier
 * ONU TR-069 cuyo `cpe_config_status` todavía no sea 'APPLIED'.
 *
 * Por qué hace falta: el primer intento (dentro de `authorizeOnu()`/
 * `reprovisionOnu()`) casi siempre falla, porque el equipo recién autorizado
 * todavía no le reportó nada a GenieACS (`findDeviceBySerial` no encuentra
 * nada) -- confirmado en vivo (2026-10-20, ONU CMDCDD4D131E). Antes de esto no
 * había NINGÚN reintento automático; un admin tenía que notar el aviso
 * (`cpeConfigWarning`) y hacer clic en "Reprovisionar" a mano.
 *
 * Cron corto (cada 2 min, no los 10 min de `GenieAcsReconciliationService`):
 * esta operación es liviana (no es el monitoreo óptico de todos los
 * dispositivos vinculados) y es justo la espera que se quiere acortar.
 *
 * Limitación conocida: para `wanMode: 'STATIC'`, los campos
 * wanStaticIp/Mask/Gw solo viajan en el `dto` original de
 * authorizeOnu/reprovisionOnu -- `onu_service_config` no los persiste todavía
 * (gap preexistente, fuera de alcance aquí). Un reintento automático para una
 * ONU en modo STATIC los manda vacíos. PPPoE no tiene este problema: sus
 * credenciales se resuelven siempre desde `network_access`, no del dto.
 */
@Injectable()
export class OnuCpeSyncReconciliationService {
  private readonly logger = new Logger(OnuCpeSyncReconciliationService.name);

  constructor(
    @InjectRepository(OnuEntity)
    private readonly onuRepository: Repository<OnuEntity>,
    private readonly onuManagementService: OnuManagementService,
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
    private readonly tenantIterator: TenantIteratorService,
  ) {}

  @Cron('*/2 * * * *')
  async handleRetry(): Promise<void> {
    await this.tenantIterator.runForEachActiveTenant('onu-cpe-sync', async () => {
      await this.retryPendingCpeConfig();
    });
  }

  async retryPendingCpeConfig(): Promise<CpeSyncRetryResult> {
    const result: CpeSyncRetryResult = { checked: 0, succeeded: 0, failed: 0 };

    if (!this.client) {
      return result;
    }

    const onus = await this.onuRepository.find({
      where: { status: 'ACTIVE' },
      relations: ['olt', 'serviceConfig'],
    });

    const pending = onus.filter(
      (onu) => onu.serviceConfig?.managementMethod === 'TR069' && onu.serviceConfig.cpeConfigStatus !== 'APPLIED',
    );
    result.checked = pending.length;

    for (const onu of pending) {
      try {
        const { cpeConfigured } = await this.onuManagementService.pushCpeConfiguration(
          onu,
          onu.serviceConfig!,
          onu.olt,
          {},
          {
            warningPrefix: 'Reintento automático de push a GenieACS',
            failureLogMessagePrefix: `[${onu.olt.vendor}] Reintento automático de push a GenieACS falló para ONU ${onu.serialNumber}`,
            operation: 'onuCpeSync.retry',
          },
        );
        if (cpeConfigured) {
          result.succeeded++;
        } else {
          result.failed++;
        }
      } catch (error) {
        // No debería llegar acá -- pushCpeConfiguration ya atrapa sus propios
        // errores -- pero un fallo individual nunca debe abortar el resto del
        // ciclo (mismo criterio que GenieAcsReconciliationService.reconcileAll).
        result.failed++;
        this.logger.error(
          `Error reintentando el push a GenieACS de la ONU ${onu.id} (serial ${onu.serialNumber}): ${(error as Error).message}`,
        );
      }
    }

    if (result.checked > 0) {
      this.logger.log(
        `Reintento push CPE: ${result.checked} ONU(s) pendiente(s), ${result.succeeded} confirmada(s), ${result.failed} aún pendiente(s)/fallida(s).`,
      );
    }
    return result;
  }
}
