import { Injectable } from '@nestjs/common';
import { NetworkProvisioningPort } from './network-provisioning.port';
import { ManualProvisioningAdapter } from './manual-provisioning.adapter';
import { RouterOsProvisioningAdapter } from './routeros-provisioning.adapter';

/**
 * Elige el adaptador de aprovisionamiento por NODO (NetworkNodeEntity.
 * provisioningMode), no globalmente — así un nodo piloto puede pasar a
 * ROUTEROS real mientras el resto del sistema sigue en MANUAL, sin ningún
 * otro cambio de código (Fase 06 del plan de integración).
 */
@Injectable()
export class NetworkProvisioningPortRegistry {
  constructor(
    private readonly manualAdapter: ManualProvisioningAdapter,
    private readonly routerOsAdapter: RouterOsProvisioningAdapter,
  ) {}

  resolve(provisioningMode: 'MANUAL' | 'ROUTEROS' | undefined): NetworkProvisioningPort {
    return provisioningMode === 'ROUTEROS' ? this.routerOsAdapter : this.manualAdapter;
  }
}
