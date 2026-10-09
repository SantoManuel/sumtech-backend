import { Injectable } from '@nestjs/common';
import { NetworkProvisioningPort } from './network-provisioning.port';
import { ManualProvisioningAdapter } from './manual-provisioning.adapter';
import { RouterOsProvisioningAdapter } from './routeros-provisioning.adapter';
import { OltNativeProvisioningAdapter } from './olt-native-provisioning.adapter';
import { DhcpProvisioningAdapter } from './dhcp-provisioning.adapter';
import { NetworkAccessEntity } from './entities/network-access.entity';

/**
 * Elige el adaptador de aprovisionamiento por NODO o por MEDIO DE CONTROL
 * (RF-RED-001/002). Conserva la compatibilidad de resolve(mode) y agrega
 * resolveForAccess(access) con resolución jerárquica de medios.
 */
@Injectable()
export class NetworkProvisioningPortRegistry {
  constructor(
    private readonly manualAdapter: ManualProvisioningAdapter,
    private readonly routerOsAdapter: RouterOsProvisioningAdapter,
    private readonly oltNativeAdapter: OltNativeProvisioningAdapter,
    private readonly dhcpAdapter: DhcpProvisioningAdapter,
  ) {}

  /**
   * Método histórico: elige adaptador por modo de aprovisionamiento del nodo.
   */
  resolve(provisioningMode: 'MANUAL' | 'ROUTEROS' | undefined): NetworkProvisioningPort {
    return provisioningMode === 'ROUTEROS' ? this.routerOsAdapter : this.manualAdapter;
  }

  /**
   * Resolución de adaptador según el medio de suspensión efectivo del acceso (Nivel 5).
   */
  resolveForAccess(access: NetworkAccessEntity): NetworkProvisioningPort {
    const medium = this.resolveSuspensionMedium(access);
    if (medium === 'OLT_NATIVE') {
      return this.oltNativeAdapter;
    }
    if (medium === 'DHCP') {
      return this.dhcpAdapter;
    }
    return this.resolve(access.node?.provisioningMode);
  }

  /**
   * Resuelve el medio de suspensión efectivo (RF-RED-001/002), en este orden estricto:
   * 1. Override a nivel de acceso (access.suspensionMediumOverride).
   * 2. Medio configurado en el router/nodo (node.suspensionMedium).
   * 3. Si no hay nodo configurado pero hay ONU vinculada: OLT_NATIVE.
   * 4. Si hay nodo pero sin medio explícito: PPPOE.
   * 5. En caso de no haber infraestructura: NONE.
   */
  resolveSuspensionMedium(access: NetworkAccessEntity): 'PPPOE' | 'OLT_NATIVE' | 'DHCP' | 'NONE' {
    if (access.suspensionMediumOverride) {
      return access.suspensionMediumOverride;
    }

    if (access.node?.suspensionMedium) {
      return access.node.suspensionMedium;
    }

    if (!access.nodeId && access.onuId) {
      return 'OLT_NATIVE';
    }

    if (access.nodeId) {
      return 'PPPOE';
    }

    return 'NONE';
  }
}
