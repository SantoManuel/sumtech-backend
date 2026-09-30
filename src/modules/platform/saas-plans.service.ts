import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SaasPlanEntity } from './entities/saas-plan.entity';
import { CreateSaasPlanDto } from './dto/create-saas-plan.dto';
import { UpdateSaasPlanDto } from './dto/update-saas-plan.dto';
import { PlatformAuditService } from './platform-audit.service';
import { SaasSubscriptionEntity } from './entities/saas-subscription.entity';

@Injectable()
export class SaasPlansService {
  constructor(
    @InjectRepository(SaasPlanEntity, 'platform')
    private readonly planRepo: Repository<SaasPlanEntity>,
    @InjectRepository(SaasSubscriptionEntity, 'platform')
    private readonly subRepo: Repository<SaasSubscriptionEntity>,
    private readonly auditService: PlatformAuditService,
  ) {}

  async findAll(onlyActive: boolean = false) {
    const where: any = {};
    if (onlyActive) {
      where.isActive = true;
    }
    return this.planRepo.find({
      where,
      order: { monthlyPrice: 'ASC' },
    });
  }

  async findOne(id: string) {
    const plan = await this.planRepo.findOne({ where: { id } });
    if (!plan) {
      throw new NotFoundException(`Plan SaaS con ID "${id}" no encontrado`);
    }
    return plan;
  }

  async create(dto: CreateSaasPlanDto, adminId?: string, ip?: string) {
    const existing = await this.planRepo.findOne({ where: { name: dto.name.trim() } });
    if (existing) {
      throw new BadRequestException(`Ya existe un plan SaaS con el nombre "${dto.name}"`);
    }

    const plan = this.planRepo.create({
      name: dto.name.trim(),
      monthlyPrice: dto.monthlyPrice,
      maxUsers: dto.maxUsers,
      maxClients: dto.maxClients,
      features: dto.features || {},
      isActive: dto.isActive !== undefined ? dto.isActive : true,
    });

    const saved = await this.planRepo.save(plan);

    await this.auditService.log({
      action: 'SAAS_PLAN_CREATED',
      entity: 'SaasPlan',
      entityId: saved.id,
      platformUserId: adminId,
      metadata: { name: saved.name, monthlyPrice: saved.monthlyPrice },
      ipAddress: ip,
    });

    return saved;
  }

  async update(id: string, dto: UpdateSaasPlanDto, adminId?: string, ip?: string) {
    const plan = await this.findOne(id);

    if (dto.name && dto.name.trim() !== plan.name) {
      const duplicate = await this.planRepo.findOne({ where: { name: dto.name.trim() } });
      if (duplicate && duplicate.id !== id) {
        throw new BadRequestException(`Ya existe otro plan SaaS con el nombre "${dto.name}"`);
      }
      plan.name = dto.name.trim();
    }

    if (dto.monthlyPrice !== undefined) plan.monthlyPrice = dto.monthlyPrice;
    if (dto.maxUsers !== undefined) plan.maxUsers = dto.maxUsers;
    if (dto.maxClients !== undefined) plan.maxClients = dto.maxClients;
    if (dto.features !== undefined) plan.features = dto.features;
    if (dto.isActive !== undefined) plan.isActive = dto.isActive;

    const saved = await this.planRepo.save(plan);

    await this.auditService.log({
      action: 'SAAS_PLAN_UPDATED',
      entity: 'SaasPlan',
      entityId: saved.id,
      platformUserId: adminId,
      metadata: { ...dto },
      ipAddress: ip,
    });

    return saved;
  }

  async remove(id: string, adminId?: string, ip?: string) {
    const plan = await this.findOne(id);

    // Verificar si hay suscripciones activas asociadas a este plan
    const activeSubsCount = await this.subRepo.count({
      where: { planId: id },
    });

    if (activeSubsCount > 0) {
      // Soft-delete desactivando el plan para no romper integridad referencial
      plan.isActive = false;
      const saved = await this.planRepo.save(plan);

      await this.auditService.log({
        action: 'SAAS_PLAN_DEACTIVATED',
        entity: 'SaasPlan',
        entityId: saved.id,
        platformUserId: adminId,
        metadata: { reason: 'Has active subscriptions, marked inactive' },
        ipAddress: ip,
      });

      return { message: 'El plan tiene suscripciones asociadas; fue desactivado en lugar de eliminado.', plan: saved };
    }

    await this.planRepo.delete(id);

    await this.auditService.log({
      action: 'SAAS_PLAN_DELETED',
      entity: 'SaasPlan',
      entityId: id,
      platformUserId: adminId,
      metadata: { name: plan.name },
      ipAddress: ip,
    });

    return { message: `Plan "${plan.name}" eliminado correctamente.` };
  }
}
