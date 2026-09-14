import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkProvisioningPort, ProvisioningResult, RouterProfileTarget } from './network-provisioning.port';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { resolveRouterOsCredentials } from './routeros/routeros-credentials';
import { ROUTEROS_CLIENT_FACTORY, RouterOsClientFactory, RouterOsClientLike } from './routeros/routeros-client-factory';
import { buildSymmetricRateLimit } from './routeros/router-profile-name.util';

type NodeAndClient =
  | { ok: true; node: NetworkNodeEntity; client: RouterOsClientLike }
  | { ok: false; error: string };

/**
 * Adaptador real de RouterOS (Fase 06 + Fase 07). Alcance deliberadamente
 * acotado sobre el SECRETO PPP del cliente: solo se habilita/deshabilita y
 * se le reasigna el perfil — nunca se crea ni se borra. Crear uno requiere
 * decidir qué pool de IP asignarle (política no decidida); en vez de
 * adivinarla, "provision" falla con un mensaje claro pidiendo que el
 * secreto se cree manualmente en el nodo primero (flujo real de campo: el
 * técnico ya crea el secreto al instalar). "deprovision" deshabilita en vez
 * de borrar — cortar el servicio debe ser reversible con solo restaurar.
 *
 * Sobre el PERFIL de velocidad (Fase 07) la disciplina es distinta a
 * propósito: syncProfile() sí puede crear/actualizar el perfil en el nodo,
 * porque es infraestructura compartida de bajo riesgo — ver la nota en
 * RouterOsClient.
 */
@Injectable()
export class RouterOsProvisioningAdapter extends NetworkProvisioningPort {
  private readonly logger = new Logger(RouterOsProvisioningAdapter.name);

  constructor(
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    @Inject(ROUTEROS_CLIENT_FACTORY)
    private readonly clientFactory: RouterOsClientFactory,
  ) {
    super();
  }

  async provision(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    return this.setDisabled(access, false, {
      missingSecretHint:
        'debe crearse manualmente en el nodo (perfil y pool de IP) antes de que Sumtech pueda activarlo por RouterOS',
    });
  }

  async suspend(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    return this.setDisabled(access, true);
  }

  async restore(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    return this.setDisabled(access, false);
  }

  async deprovision(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    return this.setDisabled(access, true);
  }

  /**
   * Garantiza que el perfil de velocidad exista con el rate-limit correcto
   * en el nodo (crea o actualiza — nunca borra) y que el secreto del
   * cliente lo tenga asignado. Idempotente en ambos pasos.
   */
  async syncProfile(access: NetworkAccessEntity, profile: RouterProfileTarget): Promise<ProvisioningResult> {
    const resolved = await this.resolveNodeAndClient(access);
    if (!resolved.ok) {
      return resolved;
    }
    const { node, client } = resolved;

    try {
      const secret = await client.findPppSecretByName(access.username!);
      if (!secret) {
        return {
          ok: false,
          error: `No existe el secreto PPP "${access.username}" en el nodo "${node.name}"; debe existir en el nodo antes de poder asignarle un perfil de velocidad.`,
        };
      }

      await client.ensureProfile(profile.name, buildSymmetricRateLimit(profile.rateLimitMbps));

      if (secret.profile === profile.name) {
        // El secreto ya apunta a este perfil — no hace falta un PATCH extra.
        return { ok: true };
      }

      await client.setPppSecretProfile(secret.id, profile.name);
      return { ok: true };
    } catch (error: any) {
      this.logger.error(
        `Error sincronizando el perfil "${profile.name}" en "${access.username}" (nodo "${node.name}"): ${error.message}`,
      );
      return { ok: false, error: error.message };
    }
  }

  private async setDisabled(
    access: NetworkAccessEntity,
    disabled: boolean,
    options?: { missingSecretHint?: string },
  ): Promise<ProvisioningResult> {
    const resolved = await this.resolveNodeAndClient(access);
    if (!resolved.ok) {
      return resolved;
    }
    const { node, client } = resolved;

    try {
      const secret = await client.findPppSecretByName(access.username!);
      if (!secret) {
        const hint = options?.missingSecretHint ?? 'debe existir en el nodo antes de poder gestionarse por RouterOS';
        return {
          ok: false,
          error: `No existe el secreto PPP "${access.username}" en el nodo "${node.name}"; ${hint}.`,
        };
      }

      if (secret.disabled === disabled) {
        // Ya está en el estado deseado — no hace falta un PATCH, y evita
        // generar ruido de "cambios" contra el nodo que no cambiaron nada.
        return { ok: true };
      }

      await client.setPppSecretDisabled(secret.id, disabled);
      return { ok: true };
    } catch (error: any) {
      this.logger.error(`Error aplicando disabled=${disabled} en "${access.username}" (nodo "${node.name}"): ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  private async resolveNodeAndClient(access: NetworkAccessEntity): Promise<NodeAndClient> {
    if (!access.username) {
      return { ok: false, error: 'El acceso no tiene usuario PPPoE configurado.' };
    }
    if (!access.nodeId) {
      return { ok: false, error: 'El acceso no tiene nodo de red asignado.' };
    }

    const node = await this.nodeRepository.findOneBy({ id: access.nodeId });
    if (!node) {
      return { ok: false, error: 'El nodo de red asignado a este acceso ya no existe.' };
    }
    if (!node.managementIp) {
      return { ok: false, error: `El nodo "${node.name}" no tiene IP de gestión configurada.` };
    }

    let credentials;
    try {
      credentials = resolveRouterOsCredentials(node.name);
    } catch (error: any) {
      return { ok: false, error: error.message };
    }

    const client = this.clientFactory({
      managementIp: node.managementIp,
      apiPort: node.apiPort,
      useHttps: node.useHttps,
      username: credentials.username,
      password: credentials.password,
    });

    return { ok: true, node, client };
  }
}
