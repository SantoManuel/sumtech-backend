import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { OltEntity } from '../entities/olt.entity';
import { RouterOsClientResolverService } from '../../network/services/routeros-client-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';

@Injectable()
export class OltNatManagerService {
  private readonly logger = new Logger(OltNatManagerService.name);

  constructor(
    @InjectRepository(OltEntity)
    private readonly oltRepository: Repository<OltEntity>,
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    private readonly clientResolver: RouterOsClientResolverService,
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

    const comment = `Sumtech-OLT-${olt.name.replace(/\s+/g, '_')}`;

    try {
      // RouterOsClientResolverService ya resuelve el endpoint alcanzable
      // (WireGuard/DDNS/IP pública), descifra la contraseña correctamente, y
      // construye el cliente correcto (REST o API Binaria) según
      // node.transportType -- antes este servicio armaba su propio cliente
      // REST a mano con `this.clientFactory` y reventaba con 400 contra
      // cualquier nodo configurado en API Binaria, ignorando por completo el
      // transporte real del nodo.
      const client = await this.clientResolver.resolveClient(node);

      const match = await client.findNatRuleByComment(comment);

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
        await client.updateFirewallNatRule(match.id, payload);
      } else {
        await client.addFirewallNatRule(payload);
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
