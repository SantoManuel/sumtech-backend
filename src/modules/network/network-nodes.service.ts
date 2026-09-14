import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { ZoneEntity } from './entities/zone.entity';
import { CreateNetworkNodeDto } from './dto/create-network-node.dto';
import { UpdateNetworkNodeDto } from './dto/update-network-node.dto';
import { ListNetworkNodesDto } from './dto/list-network-nodes.dto';

@Injectable()
export class NetworkNodesService {
  constructor(
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    @InjectRepository(ZoneEntity)
    private readonly zoneRepository: Repository<ZoneEntity>,
  ) {}

  async findAll(dto?: ListNetworkNodesDto, activeOnly = false) {
    const page = dto?.page || 1;
    const limit = dto?.limit || 20;
    const skip = (page - 1) * limit;

    const query = this.nodeRepository
      .createQueryBuilder('node')
      .leftJoinAndSelect('node.zone', 'zone')
      .skip(skip)
      .take(limit);

    if (activeOnly) {
      query.andWhere('node.isActive = :active', { active: true });
    }

    if (dto?.zoneId) {
      query.andWhere('node.zoneId = :zoneId', { zoneId: dto.zoneId });
    }

    if (dto?.search) {
      query.andWhere('node.name ILIKE :search', { search: `%${dto.search}%` });
    }

    const [data, total] = await query.orderBy('node.name', 'ASC').getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string): Promise<NetworkNodeEntity> {
    const node = await this.nodeRepository.findOne({ where: { id }, relations: ['zone'] });
    if (!node) {
      throw new NotFoundException(`Nodo de red con ID ${id} no encontrado`);
    }
    return node;
  }

  async create(dto: CreateNetworkNodeDto): Promise<NetworkNodeEntity> {
    await this.assertNameAvailable(dto.name);
    if (dto.zoneId) {
      await this.assertZoneExists(dto.zoneId);
    }

    const node = this.nodeRepository.create({
      ...dto,
      apiPort: dto.apiPort ?? 443,
      useHttps: dto.useHttps ?? true,
      provisioningMode: 'MANUAL',
      lastSyncStatus: 'NEVER',
      isActive: true,
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

    Object.assign(node, dto);
    return this.nodeRepository.save(node);
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

  private async assertNameAvailable(name: string): Promise<void> {
    const existing = await this.nodeRepository.findOneBy({ name });
    if (existing) {
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
