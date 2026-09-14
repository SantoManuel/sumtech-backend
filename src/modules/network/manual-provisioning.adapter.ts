import { Injectable, Logger } from '@nestjs/common';
import { NetworkProvisioningPort, ProvisioningResult, RouterProfileTarget } from './network-provisioning.port';
import { NetworkAccessEntity } from './entities/network-access.entity';

/**
 * Adaptador por defecto (y único disponible hasta la Fase 05 del plan de
 * integración con RouterOS): no llama a ningún nodo real. Cada operación
 * siempre tiene éxito porque no hay nada externo que pueda fallar — el
 * estado de red se administra a mano, igual que en el sistema WISP anterior
 * antes de tener integración con Mikrotik.
 */
@Injectable()
export class ManualProvisioningAdapter extends NetworkProvisioningPort {
  private readonly logger = new Logger(ManualProvisioningAdapter.name);

  async provision(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    this.logger.log(`[MANUAL] Acceso ${access.id} (contrato ${access.contractId}) marcado como aprovisionado.`);
    return { ok: true };
  }

  async suspend(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    this.logger.log(`[MANUAL] Acceso ${access.id} (contrato ${access.contractId}) marcado como suspendido.`);
    return { ok: true };
  }

  async restore(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    this.logger.log(`[MANUAL] Acceso ${access.id} (contrato ${access.contractId}) marcado como restaurado.`);
    return { ok: true };
  }

  async deprovision(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    this.logger.log(`[MANUAL] Acceso ${access.id} (contrato ${access.contractId}) marcado como cortado.`);
    return { ok: true };
  }

  async syncProfile(access: NetworkAccessEntity, profile: RouterProfileTarget): Promise<ProvisioningResult> {
    this.logger.log(
      `[MANUAL] Acceso ${access.id} (contrato ${access.contractId}) marcado con perfil "${profile.name}" (${profile.rateLimitMbps} Mbps).`,
    );
    return { ok: true };
  }
}
