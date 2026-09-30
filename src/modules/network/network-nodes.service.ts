import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { ZoneEntity } from './entities/zone.entity';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { CreateNetworkNodeDto } from './dto/create-network-node.dto';
import { UpdateNetworkNodeDto } from './dto/update-network-node.dto';
import { ListNetworkNodesDto } from './dto/list-network-nodes.dto';
import { ConnectionTestService, PreflightCheckOptions } from '../network-connectivity/services/connection-test.service';
import { WireguardManagerService } from '../network-connectivity/services/wireguard-manager.service';
import { DeviceHealthService } from '../network-connectivity/services/device-health.service';
import { DeviceOperationLogger } from '../network-connectivity/services/device-operation-logger.service';
import { encryptCredential } from '../network-connectivity/utils/crypto.util';

@Injectable()
export class NetworkNodesService {
  constructor(
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    @InjectRepository(ZoneEntity)
    private readonly zoneRepository: Repository<ZoneEntity>,
    @InjectRepository(NetworkAccessEntity)
    private readonly accessRepository: Repository<NetworkAccessEntity>,
    private readonly connectionTestService: ConnectionTestService,
    private readonly wireguardManagerService: WireguardManagerService,
    private readonly deviceHealthService: DeviceHealthService,
    private readonly deviceOperationLogger: DeviceOperationLogger,
  ) {}

  async findAll(dto?: ListNetworkNodesDto, activeOnly = false) {
    const page = dto?.page || 1;
    const limit = dto?.limit || 20;
    const skip = (page - 1) * limit;

    const query = this.nodeRepository
      .createQueryBuilder('node')
      .leftJoinAndSelect('node.zone', 'zone')
      .where('node.deletedAt IS NULL')
      .skip(skip)
      .take(limit);

    if (activeOnly) {
      query.andWhere('node.isActive = :active', { active: true });
    }

    if (dto?.zoneId) {
      query.andWhere('node.zoneId = :zoneId', { zoneId: dto.zoneId });
    }

    if (dto?.status) {
      query.andWhere('node.status = :status', { status: dto.status });
    }

    if (dto?.connectionMethod) {
      query.andWhere('node.connectionMethod = :method', { method: dto.connectionMethod });
    }

    if (dto?.search) {
      query.andWhere('(node.name ILIKE :search OR node.managementIp ILIKE :search OR node.wireguardIp ILIKE :search)', {
        search: `%${dto.search}%`,
      });
    }

    const [data, total] = await query.orderBy('node.name', 'ASC').getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string): Promise<NetworkNodeEntity> {
    const node = await this.nodeRepository.findOne({
      where: { id },
      relations: ['zone'],
    });
    if (!node || node.deletedAt) {
      throw new NotFoundException(`Nodo de red con ID ${id} no encontrado`);
    }
    return node;
  }

  async create(dto: CreateNetworkNodeDto): Promise<NetworkNodeEntity> {
    await this.assertNameAvailable(dto.name);
    if (dto.zoneId) {
      await this.assertZoneExists(dto.zoneId);
    }

    const apiPasswordEnc = dto.apiPassword ? encryptCredential(dto.apiPassword) : undefined;

    const node = this.nodeRepository.create({
      ...dto,
      apiPort: dto.apiPort ?? 443,
      useHttps: dto.useHttps ?? true,
      provisioningMode: 'MANUAL',
      lastSyncStatus: 'NEVER',
      status: 'PROVISIONING',
      isActive: true,
      apiPasswordEnc,
    });

    return this.nodeRepository.save(node);
  }

  async update(id: string, dto: UpdateNetworkNodeDto): Promise<NetworkNodeEntity> {
    const node = await this.findById(id);

    if (dto.name !== undefined && dto.name !== node.name) {
      await this.assertNameAvailable(dto.name);
    }

    if (dto.zoneId !== undefined && dto.zoneId !== null && dto.zoneId !== node.zoneId) {
      await this.assertZoneExists(dto.zoneId);
    }

    if (dto.apiPassword) {
      node.apiPasswordEnc = encryptCredential(dto.apiPassword);
    }

    const { apiPassword, ...cleanDto } = dto;
    Object.assign(node, cleanDto);

    return this.nodeRepository.save(node);
  }

  async delete(id: string): Promise<{ success: boolean; message: string }> {
    const node = await this.findById(id);

    // RF-MKT-009: Validación de dependencias antes de eliminar
    const activeAccessesCount = await this.accessRepository.count({
      where: {
        nodeId: id,
      },
    });

    if (activeAccessesCount > 0) {
      throw new ConflictException(
        `No se puede eliminar el nodo "${node.name}" porque tiene ${activeAccessesCount} acceso(s) de red asignados. Reasigne o desaprovisione los contratos primero.`,
      );
    }

    node.deletedAt = new Date();
    node.isActive = false;
    await this.nodeRepository.save(node);

    return { success: true, message: `Nodo ${node.name} eliminado correctamente` };
  }

  async deactivate(id: string): Promise<NetworkNodeEntity> {
    const node = await this.findById(id);
    if (!node.isActive) {
      return node;
    }
    node.isActive = false;
    return this.nodeRepository.save(node);
  }

  async reactivate(id: string): Promise<NetworkNodeEntity> {
    const node = await this.findById(id);
    if (node.isActive) {
      return node;
    }
    node.isActive = true;
    return this.nodeRepository.save(node);
  }

  async testConnection(options: PreflightCheckOptions) {
    return await this.connectionTestService.executePreflight(options);
  }

  async testExistingNode(id: string) {
    const node = await this.findById(id);
    return await this.connectionTestService.testNode(node);
  }

  async triggerHealthCheck(id: string, actorUserId?: string) {
    return await this.deviceHealthService.checkNodeHealth(id, actorUserId);
  }

  async getWireguardScript(id: string) {
    const node = await this.findById(id);
    if (node.connectionMethod !== 'wireguard') {
      throw new BadRequestException(`El nodo ${node.name} no está configurado con método WireGuard`);
    }

    const serverEndpoint = process.env.WIREGUARD_SERVER_ENDPOINT || 'vpn.sumtech.com.do';
    const serverPublicKey = process.env.WIREGUARD_SERVER_PUBLIC_KEY || 'SUMTECH_SERVER_PUBKEY_BASE64_ABC123=';
    const clientIp = node.wireguardIp || '10.254.1.2';

    return this.wireguardManagerService.generateRouterOsScript({
      nodeName: node.name,
      nodeId: node.id,
      tenantSlug: 'sumtech',
      assignedClientIp: clientIp,
      serverEndpoint,
      serverPublicKey,
      clientPublicKey: node.wireguardPublicKey || '',
    });
  }

  async getNodeLogs(id: string, page = 1, limit = 20) {
    await this.findById(id);
    return await this.deviceOperationLogger.getLogs({ nodeId: id, page, limit });
  }

  private async assertNameAvailable(name: string): Promise<void> {
    const existing = await this.nodeRepository.findOneBy({ name });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`Ya existe un nodo de red con el nombre "${name}"`);
    }
  }

  private async assertZoneExists(zoneId: string): Promise<void> {
    const zone = await this.zoneRepository.findOneBy({ id: zoneId });
    if (!zone) {
      throw new NotFoundException(`Zona con ID ${zoneId} no encontrada`);
    }
  }
}
