import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlanEntity } from './entities/plan.entity';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(PlanEntity)
    private readonly planRepository: Repository<PlanEntity>,
  ) {}

  async findAll(paginationDto?: PaginationDto, activeOnly = false) {
    const page = paginationDto?.page || 1;
    const limit = paginationDto?.limit || 20;
    const skip = (page - 1) * limit;

    const query = this.planRepository.createQueryBuilder('plan').skip(skip).take(limit);

    if (activeOnly) {
      query.where('plan.isActive = :active', { active: true });
    }

    const [data, total] = await query.orderBy('plan.monthlyPrice', 'ASC').getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findFeatured() {
    return this.planRepository.find({
      where: { isFeatured: true, isActive: true },
      order: { monthlyPrice: 'ASC' },
    });
  }

  async findById(id: string): Promise<PlanEntity> {
    const plan = await this.planRepository.findOneBy({ id });
    if (!plan) {
      throw new NotFoundException(`Plan con ID ${id} no encontrado`);
    }
    return plan;
  }

  async create(dto: CreatePlanDto): Promise<PlanEntity> {
    const plan = this.planRepository.create({
      ...dto,
      itbisRate: dto.itbisRate !== undefined ? dto.itbisRate : 0.18,
      isActive: true,
    });
    return this.planRepository.save(plan);
  }

  async update(id: string, dto: UpdatePlanDto): Promise<PlanEntity> {
    const plan = await this.findById(id);
    Object.assign(plan, dto);
    return this.planRepository.save(plan);
  }
}
