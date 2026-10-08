import { Injectable, Logger, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { OltEntity } from '../entities/olt.entity';
import { ROUTEROS_CLIENT_FACTORY, RouterOsClientFactory } from '../../network/routeros/routeros-client-factory';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';
import { decryptCredential } from '../../network-connectivity/utils/crypto.util';

@Injectable()
export class OltNatManagerService {
  private readonly logger = new Logger(OltNatManagerService.name);

  constructor(
    @InjectRepository(OltEntity)
    private readonly oltRepository: Repository<OltEntity>,
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    @Inject(ROUTEROS_CLIENT_FACTORY)
    private readonly clientFactory: RouterOsClientFactory,
    private readonly reachabilityResolver: ReachabilityResolver,
    private readonly deviceOperationLogger: DeviceOperationLogger,
  ) {}

  /**
   * Crea o actualiza la regla DST-NAT en el MikroTik especificado en `via_node_id` (RF-OLT-006).
   * Redirige las peticiones entrantes al puerto NAT configurado hacia la IP interna y puerto Telnet de la OLT.
   */
  async ensureOltNatRule(oltId: string, actorUserId?: string) {
    const olt = await this.oltRepository.findOneBy({ id: oltId });
    if (!olt) {
      throw new NotFoundException(`OLT no encontrada: ${oltId}`);
    }

    if (olt.connectionMethod !== 'VIA_MIKROTIK') {
      throw new BadRequestException(`La OLT no está configurada con método VIA_MIKROTIK (actual: ${olt.connectionMethod}).`);
    }

    if (!olt.viaNodeId) {
      throw new BadRequestException('La OLT no tiene un router MikroTik asignado en "via_node_id".');
    }

    const natPort = olt.natPort || 2323;
    const node = await this.nodeRepository.findOneBy({ id: olt.viaNodeId });
    if (!node) {
      throw new NotFoundException(`Router MikroTik asignado no encontrado: ${olt.viaNodeId}`);
    }

    const endpoint = await this.reachabilityResolver.resolveEndpoint(node);
    // BUG REAL (certificación HiOSO, 2026-10-08): se pasaba node.apiPasswordEnc
    // (el blob cifrado "iv:authTag:ciphertext") directo como password del
    // cliente RouterOS, sin descifrar — el router rechazaba CUALQUIER
    // contraseña real guardada con 401, sin importar cuántas veces se
    // corrigiera en la base de datos, porque nunca se estaba enviando la
    // contraseña real.
    const password = node.apiPasswordEnc ? decryptCredential(node.apiPasswordEnc) : 'admin';
    const client = this.clientFactory({
      managementIp: endpoint.host,
      apiPort: endpoint.port,
      username: node.apiUser || 'admin',
      password,
      useHttps: endpoint.useHttps,
    });

    const comment = `Sumtech-OLT-${olt.name.replace(/\s+/g, '_')}`;

    try {
      // Usamos el cliente REST de RouterOS para consultar/crear en /ip/firewall/nat
      const existingRules = await (client as any).http.get(
        (client as any).buildUrl('ip/firewall/nat'),
        {
          ...(client as any).buildRequestConfig(),
          params: { comment },
        },
      );

      const rules = Array.isArray(existingRules.data) ? existingRules.data : [];
      const match = rules.find((r: any) => r.comment === comment);

      const payload = {
        chain: 'dstnat',
        protocol: 'tcp',
        'dst-port': String(natPort),
        action: 'dst-nat',
        'to-addresses': olt.host,
        'to-ports': String(olt.port || 23),
        comment,
      };

      if (match) {
        await (client as any).http.patch(
          (client as any).buildUrl(`ip/firewall/nat/${encodeURIComponent(match['.id'])}`),
          payload,
          (client as any).buildRequestConfig(),
        );
      } else {
        await (client as any).http.put(
          (client as any).buildUrl('ip/firewall/nat'),
          payload,
          (client as any).buildRequestConfig(),
        );
      }

      await this.deviceOperationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `Regla DST-NAT creada/actualizada para OLT "${olt.name}" en puerto ${natPort} -> ${olt.host}:${olt.port}`,
        actorUserId,
        rawDetails: { oltId: olt.id, oltHost: olt.host, natPort },
      });

      return {
        success: true,
        nodeId: node.id,
        nodeName: node.name,
        natPort,
        target: `${olt.host}:${olt.port}`,
      };
    } catch (err: any) {
      this.logger.error(`Error configurando NAT en MikroTik ${node.name}: ${err.message}`);
      throw new BadRequestException(`No se pudo crear la regla NAT en el MikroTik: ${err.message}`);
    }
  }
}
