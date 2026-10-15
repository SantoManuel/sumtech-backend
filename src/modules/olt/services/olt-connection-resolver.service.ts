import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OltEntity } from '../entities/olt.entity';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { decryptCredential } from '../../network-connectivity/utils/crypto.util';
import { OltConnectionParams } from '../ports/olt-driver.port';

/**
 * Único punto de verdad para "cómo se llega a una OLT" -- antes esta lógica
 * vivía solo dentro de OltManagementService (resolveOltConnectionParams,
 * privado), así que cualquier OTRO servicio que necesitara hablarle a una
 * OLT (OltCatalogsService: admin-state de interfaz, VLAN trunk, perfiles de
 * velocidad) construía la conexión a mano con `olt.host`/`olt.port`
 * directos -- correcto para OLTs DIRECT, pero roto para VIA_MIKROTIK: ahí
 * `olt.host` es la IP privada de la OLT detrás del router (ej.
 * 192.168.0.88), inalcanzable sin pasar por el NAT del MikroTik
 * (`olt.natPort`). Confirmado en producción: causaba 400/timeout reales en
 * "Habilitar/Deshabilitar puerto" y "Permitir VLAN" contra una OLT HiOSO
 * real conectada VIA_MIKROTIK, mientras que "Escanear Ahora" (que sí usaba
 * esta resolución) funcionaba bien.
 */
@Injectable()
export class OltConnectionResolverService {
  constructor(
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    private readonly reachabilityResolver: ReachabilityResolver,
  ) {}

  async resolve(olt: OltEntity): Promise<OltConnectionParams> {
    let host = olt.host;
    let port = olt.port || 23;

    if (olt.connectionMethod === 'VIA_MIKROTIK') {
      if (!olt.viaNodeId) {
        throw new BadRequestException(`La OLT "${olt.name}" usa VIA_MIKROTIK pero no tiene viaNodeId.`);
      }
      const node = await this.nodeRepository.findOneBy({ id: olt.viaNodeId });
      if (!node) {
        throw new NotFoundException(`Router MikroTik asignado no encontrado.`);
      }
      const endpoint = await this.reachabilityResolver.resolveEndpoint(node);
      host = endpoint.host;
      port = olt.natPort || 2323;
    }

    const password = decryptCredential(olt.passwordEnc);
    const enablePassword = olt.enablePasswordEnc ? decryptCredential(olt.enablePasswordEnc) : undefined;

    return {
      host,
      port,
      username: olt.username,
      password,
      enablePassword,
    };
  }
}
