import { NetworkAccessEntity } from './entities/network-access.entity';

export interface ProvisioningResult {
  ok: boolean;
  error?: string;
}

export interface RouterProfileTarget {
  /** Nombre determinístico del perfil, ver buildRouterProfileName(). */
  name: string;
  rateLimitMbps: number;
}

/**
 * Puerto de aprovisionamiento de red: todo lo demás en el módulo (el
 * servicio, los listeners de eventos, el endpoint de configuración) habla
 * solo con esta interfaz, nunca con un adaptador concreto.
 * NetworkProvisioningPortRegistry selecciona el adaptador por nodo (ver
 * NetworkNodeEntity.provisioningMode): ManualProvisioningAdapter (por
 * defecto, no llama a ningún nodo real) o RouterOsProvisioningAdapter
 * (Fase 06, PATCH real contra el nodo).
 */
export abstract class NetworkProvisioningPort {
  abstract provision(access: NetworkAccessEntity): Promise<ProvisioningResult>;
  abstract suspend(access: NetworkAccessEntity): Promise<ProvisioningResult>;
  abstract restore(access: NetworkAccessEntity): Promise<ProvisioningResult>;
  abstract deprovision(access: NetworkAccessEntity): Promise<ProvisioningResult>;
  /**
   * Garantiza que el perfil de velocidad del plan exista en el nodo y que el
   * acceso lo tenga asignado (Fase 07). A diferencia de los demás métodos,
   * esto sí puede crear un objeto nuevo en el nodo (el perfil) — ver la nota
   * de disciplina de escritura en RouterOsClient.
   */
  abstract syncProfile(access: NetworkAccessEntity, profile: RouterProfileTarget): Promise<ProvisioningResult>;
}
