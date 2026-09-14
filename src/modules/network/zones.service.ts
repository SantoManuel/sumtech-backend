import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ZoneEntity } from './entities/zone.entity';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { ListZonesDto } from './dto/list-zones.dto';

@Injectable()
export class ZonesService {
  constructor(
    @InjectRepository(ZoneEntity)
    private readonly zoneRepository: Repository<ZoneEntity>,
  ) {}

  async findAll(dto?: ListZonesDto, activeOnly = false) {
    const page = dto?.page || 1;
    const limit = dto?.limit || 20;
    const skip = (page - 1) * limit;

    const query = this.zoneRepository.createQueryBuilder('zone').skip(skip).take(limit);

    if (activeOnly) {
      query.andWhere('zone.isActive = :active', { active: true });
    }

    if (dto?.search) {
      query.andWhere('zone.name ILIKE :search', { search: `%${dto.search}%` });
    }

    const [data, total] = await query.orderBy('zone.name', 'ASC').getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string): Promise<ZoneEntity> {
    const zone = await this.zoneRepository.findOneBy({ id });
    if (!zone) {
      throw new NotFoundException(`Zona con ID ${id} no encontrada`);
    }
    return zone;
  }

  async create(dto: CreateZoneDto): Promise<ZoneEntity> {
    await this.assertNameAvailable(dto.name);

    const zone = this.zoneRepository.create({
      ...dto,
      isActive: true,
    });
    return this.zoneRepository.save(zone);
  }

  async update(id: string, dto: UpdateZoneDto): Promise<ZoneEntity> {
    const zone = await this.findById(id);

    if (dto.name !== undefined && dto.name !== zone.name) {
      await this.assertNameAvailable(dto.name);
    }

    Object.assign(zone, dto);
    return this.zoneRepository.save(zone);
  }

  async deactivate(id: string): Promise<ZoneEntity> {
    const zone = await this.findById(id);
    if (!zone.isActive) {
      return zone;
    }
    zone.isActive = false;
    return this.zoneRepository.save(zone);
  }

  async reactivate(id: string): Promise<ZoneEntity> {
    const zone = await this.findById(id);
    if (zone.isActive) {
      return zone;
    }
    zone.isActive = true;
    return this.zoneRepository.save(zone);
  }

  private async assertNameAvailable(name: string): Promise<void> {
    const existing = await this.zoneRepository.findOneBy({ name });
    if (existing) {
      throw new ConflictException(`Ya existe una zona con el nombre "${name}"`);
    }
  }
}
