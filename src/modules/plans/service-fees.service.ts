import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceFeeEntity } from './entities/service-fee.entity';
import { CreateServiceFeeDto } from './dto/create-service-fee.dto';
import { UpdateServiceFeeDto } from './dto/update-service-fee.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class ServiceFeesService {
  constructor(
    @InjectRepository(ServiceFeeEntity)
    private readonly serviceFeeRepository: Repository<ServiceFeeEntity>,
  ) {}

  async findAll(paginationDto?: PaginationDto, activeOnly = false) {
    const page = paginationDto?.page || 1;
    const limit = paginationDto?.limit || 20;
    const skip = (page - 1) * limit;

    const query = this.serviceFeeRepository.createQueryBuilder('fee').skip(skip).take(limit);

    if (activeOnly) {
      query.andWhere('fee.isActive = :active', { active: true });
    }

    if (paginationDto?.search) {
      query.andWhere('fee.name ILIKE :search', { search: `%${paginationDto.search}%` });
    }

    const [data, total] = await query.orderBy('fee.name', 'ASC').getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string): Promise<ServiceFeeEntity> {
    const fee = await this.serviceFeeRepository.findOneBy({ id });
    if (!fee) {
      throw new NotFoundException(`Cargo de servicio con ID ${id} no encontrado`);
    }
    return fee;
  }

  async create(dto: CreateServiceFeeDto): Promise<ServiceFeeEntity> {
    const fee = this.serviceFeeRepository.create({
      ...dto,
      itbisRate: dto.itbisRate !== undefined ? dto.itbisRate : 0.18,
      isActive: true,
    });
    return this.serviceFeeRepository.save(fee);
  }

  async update(id: string, dto: UpdateServiceFeeDto): Promise<ServiceFeeEntity> {
    const fee = await this.findById(id);
    Object.assign(fee, dto);
    return this.serviceFeeRepository.save(fee);
  }

  async deactivate(id: string): Promise<ServiceFeeEntity> {
    const fee = await this.findById(id);
    if (!fee.isActive) {
      return fee;
    }
    fee.isActive = false;
    return this.serviceFeeRepository.save(fee);
  }

  async reactivate(id: string): Promise<ServiceFeeEntity> {
    const fee = await this.findById(id);
    if (fee.isActive) {
      return fee;
    }
    fee.isActive = true;
    return this.serviceFeeRepository.save(fee);
  }
}
