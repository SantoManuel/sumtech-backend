import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NapBoxEntity } from '../entities/nap-box.entity';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import { OltEntity } from '../../olt/entities/olt.entity';
import { AddressEntity } from '../../clients/entities/address.entity';
import { OnuEntity } from '../../olt/entities/onu.entity';
import { UpdateGisCoordinatesDto } from '../dto/update-gis-coordinates.dto';

export interface GisTopologyFilter {
  zoneId?: string;
  oltId?: string;
}

@Injectable()
export class GisTopologyService {
  private readonly logger = new Logger(GisTopologyService.name);

  constructor(
    @InjectRepository(NapBoxEntity)
    private readonly napBoxRepo: Repository<NapBoxEntity>,
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepo: Repository<NetworkNodeEntity>,
    @InjectRepository(OltEntity)
    private readonly oltRepo: Repository<OltEntity>,
    @InjectRepository(AddressEntity)
    private readonly addressRepo: Repository<AddressEntity>,
    @InjectRepository(OnuEntity)
    private readonly onuRepo: Repository<OnuEntity>,
  ) {}

  /**
   * Obtiene la topología completa de red georreferenciada:
   * Nodos, OLTs, Cajas NAP, Abonados ONUs y trazas de fibra óptica.
   */
  async getTopology(filter?: GisTopologyFilter) {
    // 1. Cargar Cajas NAP con sus puertos y ONUs asociadas
    const napQuery = this.napBoxRepo
      .createQueryBuilder('nap')
      .leftJoinAndSelect('nap.olt', 'olt')
      .leftJoinAndSelect('nap.ports', 'port')
      .leftJoinAndSelect('port.onu', 'onu')
      .leftJoinAndSelect('onu.contract', 'contract')
      .leftJoinAndSelect('contract.client', 'client');

    if (filter?.oltId) {
      napQuery.andWhere('nap.oltId = :oltId', { oltId: filter.oltId });
    }

    const naps = await napQuery.getMany();

    // 2. Cargar OLTs
    const olts = await this.oltRepo.find({
      relations: ['viaNode', 'zone'],
      order: { name: 'ASC' },
    });

    // 3. Cargar Nodos
    const nodes = await this.nodeRepo.find({
      relations: ['zone'],
      order: { name: 'ASC' },
    });

    // 4. Mapear NAPs georreferenciadas
    const napFeatures = naps.map((nap) => {
      const totalPorts = nap.totalPorts || 16;
      const ports = nap.ports || [];
      const occupiedPorts = ports.filter((p) => !!p.onuId).length;
      const availablePorts = Math.max(0, totalPorts - occupiedPorts);

      const clients = ports
        .filter((p) => !!p.onu && !!p.onu.contract && !!p.onu.contract.client)
        .map((p) => ({
          portNumber: p.portNumber,
          onuId: p.onu?.id,
          serialNumber: p.onu?.serialNumber,
          rxPowerDbm: p.onu?.rxPowerDbm ? Number(p.onu.rxPowerDbm) : null,
          status: p.onu?.status,
          contractId: p.onu?.contractId,
          clientId: p.onu?.contract?.clientId,
          clientName: p.onu?.contract?.client?.name,
        }));

      return {
        id: nap.id,
        name: nap.name,
        oltId: nap.oltId,
        oltName: nap.olt?.name || 'Sin OLT',
        ponInterface: nap.ponInterface,
        splitterRatio: nap.splitterRatio || '1:16',
        totalPorts,
        occupiedPorts,
        availablePorts,
        occupancyRate: totalPorts > 0 ? Math.round((occupiedPorts / totalPorts) * 100) : 0,
        address: nap.address,
        latitude: nap.latitude ? Number(nap.latitude) : null,
        longitude: nap.longitude ? Number(nap.longitude) : null,
        hasCoordinates: !!(nap.latitude && nap.longitude),
        clients,
      };
    });

    // 5. Cargar Abonados / ONUs que tienen coordenadas en las direcciones de sus contratos
    const onusWithGps = await this.onuRepo
      .createQueryBuilder('onu')
      .leftJoinAndSelect('onu.olt', 'olt')
      .leftJoinAndSelect('onu.napPort', 'napPort')
      .leftJoinAndSelect('napPort.nap', 'napBox')
      .leftJoinAndSelect('onu.contract', 'contract')
      .leftJoinAndSelect('contract.client', 'client')
      .leftJoinAndSelect('contract.address', 'address')
      .where('address.gpsLatitude IS NOT NULL')
      .andWhere('address.gpsLongitude IS NOT NULL')
      .getMany();

    const subscribers = onusWithGps.map((onu) => {
      const lat = onu.contract?.address?.gpsLatitude ? Number(onu.contract.address.gpsLatitude) : null;
      const lng = onu.contract?.address?.gpsLongitude ? Number(onu.contract.address.gpsLongitude) : null;
      const napBox = onu.napPort?.nap;

      return {
        onuId: onu.id,
        serialNumber: onu.serialNumber,
        model: onu.model,
        rxPowerDbm: onu.rxPowerDbm ? Number(onu.rxPowerDbm) : null,
        txPowerDbm: onu.txPowerDbm ? Number(onu.txPowerDbm) : null,
        status: onu.status || 'ACTIVE',
        contractId: onu.contractId,
        contractNumber: onu.contract?.contractNumber,
        clientId: onu.contract?.clientId,
        clientName: onu.contract?.client?.name || 'Cliente sin nombre',
        clientDoc: onu.contract?.client?.docNumber,
        oltId: onu.oltId,
        oltName: onu.olt?.name,
        napBoxId: napBox?.id,
        napBoxName: napBox?.name,
        napPortNumber: onu.napPort?.portNumber,
        latitude: lat,
        longitude: lng,
        hasCoordinates: !!(lat && lng),
      };
    });

    // 6. Generar líneas de conexión de fibra óptica
    // Acometida (Drop): Desde NAP hacia cada Cliente / ONU (si ambos tienen coordenadas)
    const fiberLines: Array<{
      id: string;
      type: 'DISTRIBUTION' | 'DROP';
      fromName: string;
      toName: string;
      coordinates: Array<[number, number]>;
      status: 'OK' | 'ALARM' | 'LOS';
    }> = [];

    subscribers.forEach((sub) => {
      if (sub.latitude && sub.longitude && sub.napBoxId) {
        const nap = napFeatures.find((n) => n.id === sub.napBoxId);
        if (nap && nap.latitude && nap.longitude) {
          fiberLines.push({
            id: `drop-${sub.onuId}`,
            type: 'DROP',
            fromName: nap.name,
            toName: sub.clientName,
            coordinates: [
              [nap.latitude, nap.longitude],
              [sub.latitude, sub.longitude],
            ],
            status: sub.status === 'LOS' ? 'LOS' : sub.status === 'ACTIVE' ? 'OK' : 'ALARM',
          });
        }
      }
    });

    // Estadísticas globales GIS
    const totalNaps = napFeatures.length;
    const georeferencedNaps = napFeatures.filter((n) => n.hasCoordinates).length;
    const totalSubscribers = subscribers.length;
    const totalPortsSum = napFeatures.reduce((acc, n) => acc + n.totalPorts, 0);
    const occupiedPortsSum = napFeatures.reduce((acc, n) => acc + n.occupiedPorts, 0);

    return {
      summary: {
        totalNaps,
        georeferencedNaps,
        totalSubscribers,
        totalPortsSum,
        occupiedPortsSum,
        availablePortsSum: Math.max(0, totalPortsSum - occupiedPortsSum),
        networkCapacityPercentage: totalPortsSum > 0 ? Math.round((occupiedPortsSum / totalPortsSum) * 100) : 0,
      },
      naps: napFeatures,
      olts: olts.map((o) => ({
        id: o.id,
        name: o.name,
        vendor: o.vendor,
        model: o.model,
        host: o.host,
        status: o.status,
        connectionStatus: o.connectionStatus,
        zoneName: o.zone?.name,
      })),
      nodes: nodes.map((n) => ({
        id: n.id,
        name: n.name,
        model: n.model,
        managementIp: n.managementIp,
        status: n.status,
        zoneName: n.zone?.name,
      })),
      subscribers,
      fiberLines,
    };
  }

  /**
   * Actualiza las coordenadas geográficas de una Caja NAP
   */
  async updateNapCoordinates(id: string, dto: UpdateGisCoordinatesDto) {
    const nap = await this.napBoxRepo.findOne({ where: { id } });
    if (!nap) {
      throw new NotFoundException(`Caja NAP con identificador "${id}" no encontrada`);
    }

    nap.latitude = dto.latitude;
    nap.longitude = dto.longitude;
    await this.napBoxRepo.save(nap);

    this.logger.log(`Coordenadas de Caja NAP "${nap.name}" actualizadas: [${dto.latitude}, ${dto.longitude}]`);

    return {
      id: nap.id,
      name: nap.name,
      latitude: Number(nap.latitude),
      longitude: Number(nap.longitude),
      updatedAt: new Date(),
    };
  }

  /**
   * Actualiza las coordenadas GPS del domicilio principal de un cliente
   */
  async updateClientCoordinates(clientId: string, dto: UpdateGisCoordinatesDto) {
    let address = await this.addressRepo.findOne({
      where: { clientId, isPrimary: true },
    });

    if (!address) {
      address = await this.addressRepo.findOne({
        where: { clientId },
      });
    }

    if (!address) {
      throw new NotFoundException(`No se encontró domicilio registrado para el cliente "${clientId}"`);
    }

    address.gpsLatitude = dto.latitude;
    address.gpsLongitude = dto.longitude;
    await this.addressRepo.save(address);

    this.logger.log(`Coordenadas de cliente "${clientId}" actualizadas: [${dto.latitude}, ${dto.longitude}]`);

    return {
      clientId,
      addressId: address.id,
      latitude: Number(address.gpsLatitude),
      longitude: Number(address.gpsLongitude),
      updatedAt: new Date(),
    };
  }
}
