import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkProvisioningPort, ProvisioningResult, RouterProfileTarget } from './network-provisioning.port';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { resolveRouterOsCredentials } from './routeros/routeros-credentials';
import { ROUTEROS_CLIENT_FACTORY, RouterOsClientFactory, RouterOsClientLike } from './routeros/routeros-client-factory';
import { buildSymmetricRateLimit } from './routeros/router-profile-name.util';
import { ReachabilityResolver } from '../network-connectivity/services/reachability-resolver.service';
import { decryptCredential } from '../network-connectivity/utils/crypto.util';

type NodeAndClient =
  | { ok: true; node: NetworkNodeEntity; client: RouterOsClientLike }
  | { ok: false; error: string };

/**
 * Adaptador de aprovisionamiento en tiempo real para MikroTik RouterOS (Nivel 2).
 * Gestiona de forma automatizada e idempotente:
 * - Creación y sincronización de secretos PPPoE (/ppp/secret)
 * - Creación y actualización de perfiles de velocidad (/ppp/profile) con colas padre
 * - Expulsión de sesiones activas en caliente (/ppp/active) ante corte, cambio de plan o reconexión
 */
@Injectable()
export class RouterOsProvisioningAdapter extends NetworkProvisioningPort {
  private readonly logger = new Logger(RouterOsProvisioningAdapter.name);

  constructor(
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    @InjectRepository(NetworkAccessEntity)
    private readonly accessRepository: Repository<NetworkAccessEntity>,
    @Inject(ROUTEROS_CLIENT_FACTORY)
    private readonly clientFactory: RouterOsClientFactory,
    private readonly reachabilityResolver: ReachabilityResolver,
  ) {
    super();
  }

  /**
   * Aprovisiona el acceso PPPoE en el nodo de forma automatizada e idempotente (RF-PPP-004 / RF-PPP-005).
   * Si el secreto no existe en RouterOS, lo crea con su contraseña, perfil y dirección IP asignada.
   */
  async provision(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    const resolved = await this.resolveNodeAndClient(access);
    if (!resolved.ok) {
      return resolved;
    }
    const { node, client } = resolved;

    try {
      const password = access.pppoePasswordEnc
        ? decryptCredential(access.pppoePasswordEnc)
        : 'SumtechPass2026!';
      const profile = access.serviceAlias || 'default';

      await client.ensurePppSecret({
        name: access.username!,
        password,
        profile,
        service: 'pppoe',
        remoteAddress: access.ipAddress || undefined,
        comment: `Contrato:${access.contractId}`,
        disabled: false,
      });

      this.logger.log(`Aprovisionado secret PPPoE "${access.username}" en nodo "${node.name}"`);
      return { ok: true };
    } catch (error: any) {
      this.logger.error(`Error aprovisionando secret "${access.username}" en nodo "${node.name}": ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Suspende el servicio PPPoE:
   * - Modo DISABLED: deshabilita el secret y expulsa la sesión (RF-PPP-006).
   * - Modo NOTICE_PORTAL: mantiene el secret activo pero redirige a portal cautivo vía address-list sumtech-suspendidos (RF-PORTAL-001).
   */
  async suspend(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    const resolved = await this.resolveNodeAndClient(access);
    if (!resolved.ok) return resolved;
    const { node, client } = resolved;

    if (node.suspensionMode === 'NOTICE_PORTAL') {
      try {
        // Asegurar que el secret esté activo
        const secret = await client.findPppSecretByName(access.username!);
        if (secret && secret.disabled) {
          await client.setPppSecretDisabled(secret.id, false);
        }

        // Si el acceso o la sesión activa tienen IP, agregar a sumtech-suspendidos
        const active = await client.findActiveSessionByName(access.username!);
        const targetIp = access.ipAddress || active?.address;

        if (targetIp) {
          await client.addAddressListEntry(
            'sumtech-suspendidos',
            targetIp,
            `SUSPENDIDO-${access.username}`,
          );
        }

        // Reconectar la sesión para que tome las nuevas restricciones del portal cautivo
        await this.killSessionIfExists(access);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    }

    const res = await this.setDisabled(access, true);
    if (!res.ok) return res;

    // Desconectar sesión activa en caliente
    await this.killSessionIfExists(access);
    return { ok: true };
  }

  /**
   * Reactiva el servicio PPPoE:
   * - Habilita el secret si estaba deshabilitado.
   * - Remueve la IP de sumtech-suspendidos si estaba en modo portal (RF-PORTAL-001/RF-PPP-007).
   */
  async restore(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    const resolved = await this.resolveNodeAndClient(access);
    if (!resolved.ok) return resolved;
    const { node, client } = resolved;

    try {
      const secret = await client.findPppSecretByName(access.username!);
      if (secret && secret.disabled) {
        await client.setPppSecretDisabled(secret.id, false);
      }

      if (node.suspensionMode === 'NOTICE_PORTAL') {
        const active = await client.findActiveSessionByName(access.username!);
        const targetIp = access.ipAddress || active?.address;
        if (targetIp) {
          await client.removeAddressListEntry('sumtech-suspendidos', targetIp);
        }
      }

      // Expulsar sesión residual para reconexión limpia a velocidad completa
      await this.killSessionIfExists(access);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Desaprovisiona el acceso: deshabilita el secret y tumba la sesión activa.
   */
  async deprovision(access: NetworkAccessEntity): Promise<ProvisioningResult> {
    const res = await this.setDisabled(access, true);
    if (!res.ok) return res;

    await this.killSessionIfExists(access);
    return { ok: true };
  }

  /**
   * Garantiza que el perfil de velocidad exista con rate-limit y cola padre (RF-PPP-001/002),
   * lo asigna al secreto del abonado y expulsa la sesión activa para aplicar el cambio en caliente (RF-PPP-008).
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
          error: `No existe el secreto PPP "${access.username}" en el nodo "${node.name}". Debe aprovisionarse antes de sincronizar perfiles.`,
        };
      }

      await client.ensureProfile(
        profile.name,
        buildSymmetricRateLimit(profile.rateLimitMbps),
        {
          parentQueue: node.defaultParentQueue || undefined,
          remoteAddress: node.defaultPppPool || undefined,
          onlyOne: true,
        },
      );

      if (secret.profile !== profile.name) {
        await client.setPppSecretProfile(secret.id, profile.name);
      }

      // Expulsar sesión activa en caliente para aplicar inmediatamente el nuevo ancho de banda
      await this.killSessionIfExists(access);

      return { ok: true };
    } catch (error: any) {
      this.logger.error(
        `Error sincronizando perfil "${profile.name}" en "${access.username}" (nodo "${node.name}"): ${error.message}`,
      );
      return { ok: false, error: error.message };
    }
  }

  private async killSessionIfExists(access: NetworkAccessEntity): Promise<void> {
    try {
      const resolved = await this.resolveNodeAndClient(access);
      if (resolved.ok && access.username) {
        const active = await resolved.client.findActiveSessionByName(access.username);
        if (active) {
          // Guardar última MAC detectada
          if (active.callerId) {
            await this.accessRepository.update(
              { id: access.id },
              { macAddress: active.callerId, lastCallerId: active.callerId },
            );
          }
          await resolved.client.killActiveSession(access.username);
          this.logger.log(`Sesión activa de "${access.username}" expulsada en caliente en "${resolved.node.name}"`);
        }
      }
    } catch (err: any) {
      this.logger.warn(`No se pudo expulsar sesión activa de "${access.username}": ${err.message}`);
    }
  }

  private async setDisabled(
    access: NetworkAccessEntity,
    disabled: boolean,
  ): Promise<ProvisioningResult> {
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
          error: `No existe el secreto PPP "${access.username}" en el nodo "${node.name}". Debe aprovisionarse antes de cambiar su estado.`,
        };
      }

      if (secret.disabled === disabled) {
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

    let host = node.managementIp;
    let port = node.apiPort;
    let useHttps = node.useHttps;

    try {
      const endpoint = await this.reachabilityResolver.resolveEndpoint(node);
      host = endpoint.host;
      port = endpoint.port;
      useHttps = endpoint.useHttps;
    } catch {
      // Fallback a managementIp
    }

    if (!host) {
      return { ok: false, error: `El nodo "${node.name}" no tiene IP de gestión o túnel WireGuard alcanzable.` };
    }

    let username = node.apiUser || 'admin';
    let password = '';

    if (node.apiPasswordEnc) {
      password = decryptCredential(node.apiPasswordEnc);
    } else {
      try {
        const credentials = resolveRouterOsCredentials(node.name);
        username = credentials.username;
        password = credentials.password;
      } catch (error: any) {
        return { ok: false, error: error.message };
      }
    }

    const client = this.clientFactory({
      managementIp: host,
      apiPort: port,
      useHttps,
      username,
      password,
    });

    return { ok: true, node, client };
  }
}
