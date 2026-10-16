import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NapBoxEntity } from '../entities/nap-box.entity';
import { NapPortEntity } from '../entities/nap-port.entity';
import { OnuEntity } from '../../olt/entities/onu.entity';
import {
  CreateNapBoxDto,
  UpdateNapBoxDto,
  ListNapBoxesDto,
  UpdateNapPortDto,
} from '../dto/nap.dto';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';

@Injectable()
export class NapManagementService {
  private readonly logger = new Logger(NapManagementService.name);

  constructor(
    @InjectRepository(NapBoxEntity)
    private readonly napRepository: Repository<NapBoxEntity>,
    @InjectRepository(NapPortEntity)
    private readonly portRepository: Repository<NapPortEntity>,
    @InjectRepository(OnuEntity)
    private readonly onuRepository: Repository<OnuEntity>,
    private readonly deviceOperationLogger: DeviceOperationLogger,
  ) {}

  async findAll(dto?: ListNapBoxesDto) {
    const page = dto?.page || 1;
    const limit = dto?.limit || 20;
    const skip = (page - 1) * limit;

    const query = this.napRepository
      .createQueryBuilder('nap')
      .leftJoinAndSelect('nap.olt', 'olt')
      .leftJoinAndSelect('nap.zone', 'zone')
      .leftJoinAndSelect('nap.ports', 'ports')
      .skip(skip)
      .take(limit)
      .orderBy('nap.name', 'ASC');

    if (dto?.zoneId) {
      query.andWhere('nap.zoneId = :zoneId', { zoneId: dto.zoneId });
    }
    if (dto?.oltId) {
      query.andWhere('nap.oltId = :oltId', { oltId: dto.oltId });
    }
    if (dto?.status) {
      query.andWhere('nap.status = :status', { status: dto.status });
    }
    if (dto?.search) {
      query.andWhere('(nap.name ILIKE :search OR nap.address ILIKE :search OR nap.ponInterface ILIKE :search)', {
        search: `%${dto.search}%`,
      });
    }

    const [boxes, total] = await query.getManyAndCount();

    const data = boxes.map((box) => {
      const ports = box.ports || [];
      const portsOccupied = ports.filter((p) => p.status === 'OCUPADO').length;
      const portsAvailable = ports.filter((p) => p.status === 'DISPONIBLE').length;
      const portsDamaged = ports.filter((p) => p.status === 'DANADO').length;
      const portsReserved = ports.filter((p) => p.status === 'RESERVADO').length;
      const totalPorts = box.totalPorts || ports.length || 16;
      const occupancyPercent = totalPorts > 0 ? Math.round((portsOccupied / totalPorts) * 100) : 0;

      return {
        ...box,
        portsOccupied,
        portsAvailable,
        portsDamaged,
        portsReserved,
        occupancyPercent,
      };
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string) {
    const box = await this.napRepository.findOne({
      where: { id },
      relations: ['olt', 'zone', 'ports', 'ports.onu', 'ports.onu.contract', 'ports.onu.contract.client'],
    });

    if (!box) {
      throw new NotFoundException(`Caja NAP no encontrada: ${id}`);
    }

    if (box.ports) {
      box.ports.sort((a, b) => a.portNumber - b.portNumber);
    }

    const ports = box.ports || [];
    const portsOccupied = ports.filter((p) => p.status === 'OCUPADO').length;
    const portsAvailable = ports.filter((p) => p.status === 'DISPONIBLE').length;
    const portsDamaged = ports.filter((p) => p.status === 'DANADO').length;
    const portsReserved = ports.filter((p) => p.status === 'RESERVADO').length;
    const occupancyPercent = box.totalPorts > 0 ? Math.round((portsOccupied / box.totalPorts) * 100) : 0;

    return {
      ...box,
      portsOccupied,
      portsAvailable,
      portsDamaged,
      portsReserved,
      occupancyPercent,
    };
  }

  async create(dto: CreateNapBoxDto, actorUserId?: string) {
    const totalPorts = dto.totalPorts || 16;
    const nap = this.napRepository.create({
      name: dto.name,
      oltId: dto.oltId ?? null,
      ponInterface: dto.ponInterface ?? null,
      splitterRatio: dto.splitterRatio || '1:16',
      totalPorts,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      address: dto.address ?? null,
      zoneId: dto.zoneId ?? null,
      notes: dto.notes ?? null,
      status: 'ACTIVO',
    } as Partial<NapBoxEntity>);

    const saved = await this.napRepository.save(nap as NapBoxEntity);

    // Inicialización automática de los puertos de 1 a totalPorts
    const ports: NapPortEntity[] = [];
    for (let i = 1; i <= totalPorts; i++) {
      ports.push(
        this.portRepository.create({
          napId: saved.id,
          portNumber: i,
          status: 'DISPONIBLE',
        } as Partial<NapPortEntity>) as NapPortEntity,
      );
    }
    await this.portRepository.save(ports);

    await this.deviceOperationLogger.logEvent({
      nodeId: saved.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `Caja NAP creada: "${saved.name}" (${totalPorts} puertos, splitter ${saved.splitterRatio})`,
      actorUserId,
      rawDetails: { napId: saved.id, totalPorts },
    });

    return this.findById(saved.id);
  }

  async update(id: string, dto: UpdateNapBoxDto, actorUserId?: string) {
    const box = await this.napRepository.findOneBy({ id });
    if (!box) {
      throw new NotFoundException(`Caja NAP no encontrada: ${id}`);
    }

    if (dto.name !== undefined) box.name = dto.name;
    if (dto.oltId !== undefined) box.oltId = dto.oltId ?? null;
    if (dto.ponInterface !== undefined) box.ponInterface = dto.ponInterface ?? null;
    if (dto.splitterRatio !== undefined) box.splitterRatio = dto.splitterRatio;
    if (dto.latitude !== undefined) box.latitude = dto.latitude ?? null;
    if (dto.longitude !== undefined) box.longitude = dto.longitude ?? null;
    if (dto.address !== undefined) box.address = dto.address ?? null;
    if (dto.zoneId !== undefined) box.zoneId = dto.zoneId ?? null;
    if (dto.status !== undefined) box.status = dto.status;
    if (dto.notes !== undefined) box.notes = dto.notes ?? null;

    await this.napRepository.save(box);

    await this.deviceOperationLogger.logEvent({
      nodeId: box.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `Caja NAP actualizada: "${box.name}"`,
      actorUserId,
    });

    return this.findById(id);
  }

  async delete(id: string, actorUserId?: string) {
    const box = await this.napRepository.findOne({
      where: { id },
      relations: ['ports'],
    });
    if (!box) {
      throw new NotFoundException(`Caja NAP no encontrada: ${id}`);
    }

    // Verificar si hay puertos ocupados con ONUs
    const occupied = (box.ports || []).filter((p) => p.status === 'OCUPADO' || p.onuId);
    if (occupied.length > 0) {
      throw new BadRequestException(
        `No se puede eliminar la caja NAP "${box.name}" porque tiene ${occupied.length} puerto(s) con ONUs asignadas. Libere los puertos antes de continuar.`,
      );
    }

    await this.napRepository.delete(id);

    await this.deviceOperationLogger.logEvent({
      nodeId: id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `Caja NAP eliminada: "${box.name}"`,
      actorUserId,
    });

    return { ok: true, id };
  }

  async updatePort(
    napId: string,
    portNumber: number,
    dto: UpdateNapPortDto,
    actorUserId?: string,
  ) {
    const port = await this.portRepository.findOne({
      where: { napId, portNumber },
      relations: ['nap', 'onu'],
    });

    if (!port) {
      throw new NotFoundException(`Puerto ${portNumber} no encontrado en la Caja NAP ${napId}`);
    }

    const previousOnuId = port.onuId;

    if (dto.onuId !== undefined) {
      if (dto.onuId) {
        const onu = await this.onuRepository.findOneBy({ id: dto.onuId });
        if (!onu) {
          throw new NotFoundException(`ONU no encontrada: ${dto.onuId}`);
        }

        // Si la ONU ya estaba en otro puerto, desasociarla
        const existingPort = await this.portRepository.findOneBy({ onuId: dto.onuId });
        if (existingPort && existingPort.id !== port.id) {
          existingPort.onuId = null;
          existingPort.status = 'DISPONIBLE';
          await this.portRepository.save(existingPort);
        }

        port.onuId = dto.onuId;
        port.status = dto.status || 'OCUPADO';

        // Sincronizar en la entidad ONU
        await this.onuRepository.update(onu.id, { napPortId: port.id });
      } else {
        // Desasociar ONU
        if (previousOnuId) {
          await this.onuRepository.update(previousOnuId, { napPortId: null as any });
        }
        port.onuId = null;
        port.status = dto.status || 'DISPONIBLE';
      }
    } else if (dto.status) {
      port.status = dto.status;
    }

    if (dto.attenuationDb !== undefined) {
      port.attenuationDb = dto.attenuationDb;
    }
    if (dto.notes !== undefined) {
      port.notes = dto.notes;
    }

    const savedPort = await this.portRepository.save(port);

    await this.deviceOperationLogger.logEvent({
      nodeId: napId,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `Puerto ${portNumber} de NAP "${port.nap?.name || napId}" actualizado (Estado: ${savedPort.status}, ONU: ${savedPort.onuId || 'Ninguna'}).`,
      actorUserId,
      rawDetails: { napId, portNumber, status: savedPort.status, onuId: savedPort.onuId },
    });

    return savedPort;
  }

  async getGisPoints() {
    const boxes = await this.napRepository
      .createQueryBuilder('nap')
      .leftJoinAndSelect('nap.zone', 'zone')
      .leftJoinAndSelect('nap.ports', 'ports')
      .where('nap.latitude IS NOT NULL AND nap.longitude IS NOT NULL')
      .getMany();

    return boxes.map((box) => {
      const ports = box.ports || [];
      const portsOccupied = ports.filter((p) => p.status === 'OCUPADO').length;
      const totalPorts = box.totalPorts || ports.length || 16;
      return {
        id: box.id,
        name: box.name,
        address: box.address,
        latitude: box.latitude,
        longitude: box.longitude,
        splitterRatio: box.splitterRatio,
        zoneName: box.zone?.name || null,
        totalPorts,
        portsOccupied,
        portsAvailable: totalPorts - portsOccupied,
        occupancyPercent: totalPorts > 0 ? Math.round((portsOccupied / totalPorts) * 100) : 0,
        status: box.status,
      };
    });
  }
}
