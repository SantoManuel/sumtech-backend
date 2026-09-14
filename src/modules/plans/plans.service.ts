import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PlanEntity } from './entities/plan.entity';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { SystemEvents } from '../../common/enums/system-events.enum';
import { PlanSpeedChangedEvent } from './events/plan-speed-changed.event';

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(PlanEntity)
    private readonly planRepository: Repository<PlanEntity>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(paginationDto?: PaginationDto, activeOnly = false) {
    const page = paginationDto?.page || 1;
    const limit = paginationDto?.limit || 20;
    const skip = (page - 1) * limit;

    const query = this.planRepository.createQueryBuilder('plan').skip(skip).take(limit);

    if (activeOnly) {
      query.andWhere('plan.isActive = :active', { active: true });
    }

    if (paginationDto?.search) {
      query.andWhere('plan.name ILIKE :search', { search: `%${paginationDto.search}%` });
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
    const previousSpeedMbps = Number(plan.speedMbps);
    Object.assign(plan, dto);
    const saved = await this.planRepository.save(plan);

    if (dto.speedMbps !== undefined && Number(dto.speedMbps) !== previousSpeedMbps) {
      const event: PlanSpeedChangedEvent = {
        planId: saved.id,
        planName: saved.name,
        oldSpeedMbps: previousSpeedMbps,
        newSpeedMbps: Number(dto.speedMbps),
        occurredOn: new Date(),
      };
      this.eventEmitter.emit(SystemEvents.PLAN_SPEED_CHANGED, event);
    }

    return saved;
  }

  async deactivate(id: string): Promise<PlanEntity> {
    const plan = await this.findById(id);
    if (!plan.isActive) {
      return plan;
    }
    plan.isActive = false;
    return this.planRepository.save(plan);
  }

  async reactivate(id: string): Promise<PlanEntity> {
    const plan = await this.findById(id);
    if (plan.isActive) {
      return plan;
    }
    plan.isActive = true;
    return this.planRepository.save(plan);
  }
}
