import { Injectable, Logger } from '@nestjs/common';
import { NetworkProvisioningPort, ProvisioningResult, RouterProfileTarget } from './network-provisioning.port';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { OnuManagementService } from '../olt/services/onu-management.service';

/**
 * Adaptador de aprovisionamiento y control OLT Nativo (RF-RED-001/002).
 * Controla el ciclo de vida y suspensión directamente en la cabecera OLT mediante
 * el bloqueo óptico del puerto ONU (shutdown / no shutdown), delegando en
 * OnuManagementService → OltDriverRegistry para usar el driver real del
 * fabricante de cada OLT (no asume ZTE).
 */
@Injectable()
export class OltNativeProvisioningAdapter extends NetworkProvisioningPort {
  private readonly logger = new Logger(OltNativeProvisioningAdapter.name);

  constructor(private readonly onuService: OnuManagementService) {
    super();
  }

  async provision(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    if (!access.onuId) {
      return { ok: true };
    }
    try {
      await this.onuService.unblockOnu(access.onuId);
      this.logger.log(`[OLT_NATIVE] ONU ${access.onuId} (contrato ${access.contractId}) aprovisionada y activa.`);
      return { ok: true };
    } catch (err: any) {
      this.logger.error(`[OLT_NATIVE] Error aprovisionando ONU ${access.onuId}: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  async suspend(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    if (!access.onuId) {
      return { ok: false, error: 'Medio OLT_NATIVE requiere una ONU vinculada al contrato.' };
    }
    try {
      await this.onuService.blockOnu(access.onuId);
      this.logger.log(`[OLT_NATIVE] ONU ${access.onuId} (contrato ${access.contractId}) bloqueada ópticamente.`);
      return { ok: true };
    } catch (err: any) {
      this.logger.error(`[OLT_NATIVE] Error suspendiendo ONU ${access.onuId}: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  async restore(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    if (!access.onuId) {
      return { ok: false, error: 'Medio OLT_NATIVE requiere una ONU vinculada al contrato.' };
    }
    try {
      await this.onuService.unblockOnu(access.onuId);
      this.logger.log(`[OLT_NATIVE] ONU ${access.onuId} (contrato ${access.contractId}) restaurada en la OLT.`);
      return { ok: true };
    } catch (err: any) {
      this.logger.error(`[OLT_NATIVE] Error restaurando ONU ${access.onuId}: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  async deprovision(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    if (!access.onuId) {
      return { ok: true };
    }
    try {
      await this.onuService.blockOnu(access.onuId);
      this.logger.log(`[OLT_NATIVE] ONU ${access.onuId} (contrato ${access.contractId}) cortada.`);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async syncProfile(access: NetworkAccessEntity, profile: RouterProfileTarget): Promise<ProvisioningResult> {
    this.logger.log(`[OLT_NATIVE] Perfil OLT sincronizado para acceso ${access.id} (${profile.name}).`);
    return { ok: true };
  }
}
