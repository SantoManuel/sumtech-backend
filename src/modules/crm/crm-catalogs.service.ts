import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionStatusEntity } from './entities/subscription-status.entity';
import { NextActionEntity } from './entities/next-action.entity';
import { LossReasonEntity } from './entities/loss-reason.entity';
import { SlaPolicyEntity } from './entities/sla-policy.entity';
import {
  CreateSubscriptionStatusDto,
  UpdateSubscriptionStatusDto,
  CreateNextActionDto,
  UpdateNextActionDto,
  CreateLossReasonDto,
  UpdateLossReasonDto,
  UpsertSlaPolicyDto,
} from './dto/catalog.dto';

/**
 * Genera un `code` estable e inmutable a partir del nombre (ej. "En
 * Negociación Avanzada" -> "EN_NEGOCIACION_AVANZADA") para los catálogos que
 * lo requieren (subscription_statuses, next_actions) — el administrador solo
 * captura el nombre visible, nunca el código interno. Si el código generado
 * ya existe, se le agrega un sufijo numérico hasta encontrar uno libre.
 */
function slugToCode(name: string, maxLength: number): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength);
  return base || 'ESTADO';
}

@Injectable()
export class CrmCatalogsService {
  constructor(
    @InjectRepository(SubscriptionStatusEntity)
    private readonly subscriptionStatusRepository: Repository<SubscriptionStatusEntity>,
    @InjectRepository(NextActionEntity)
    private readonly nextActionRepository: Repository<NextActionEntity>,
    @InjectRepository(LossReasonEntity)
    private readonly lossReasonRepository: Repository<LossReasonEntity>,
    @InjectRepository(SlaPolicyEntity)
    private readonly slaPolicyRepository: Repository<SlaPolicyEntity>,
  ) {}

  // --- Estados de Suscripción ---

  async findAllSubscriptionStatuses(includeInactive = false): Promise<SubscriptionStatusEntity[]> {
    return this.subscriptionStatusRepository.find({
      where: includeInactive ? {} : { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async createSubscriptionStatus(dto: CreateSubscriptionStatusDto): Promise<SubscriptionStatusEntity> {
    const code = await this.generateUniqueCode(this.subscriptionStatusRepository, dto.name, 30);
    const entity = this.subscriptionStatusRepository.create({
      code,
      name: dto.name,
      description: dto.description,
      sortOrder: dto.sortOrder ?? 0,
      isActive: true,
    });
    return this.subscriptionStatusRepository.save(entity);
  }

  async updateSubscriptionStatus(id: string, dto: UpdateSubscriptionStatusDto): Promise<SubscriptionStatusEntity> {
    const entity = await this.subscriptionStatusRepository.findOneBy({ id });
    if (!entity) {
      throw new NotFoundException(`Estado de suscripción con ID ${id} no encontrado`);
    }
    Object.assign(entity, dto);
    return this.subscriptionStatusRepository.save(entity);
  }

  // --- Próximas Acciones ---

  async findAllNextActions(includeInactive = false): Promise<NextActionEntity[]> {
    return this.nextActionRepository.find({
      where: includeInactive ? {} : { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async createNextAction(dto: CreateNextActionDto): Promise<NextActionEntity> {
    const code = await this.generateUniqueCode(this.nextActionRepository, dto.name, 50);
    const entity = this.nextActionRepository.create({
      code,
      name: dto.name,
      suggestedStatusCodes: dto.suggestedStatusCodes ?? [],
      sortOrder: dto.sortOrder ?? 0,
      isActive: true,
    });
    return this.nextActionRepository.save(entity);
  }

  async updateNextAction(id: string, dto: UpdateNextActionDto): Promise<NextActionEntity> {
    const entity = await this.nextActionRepository.findOneBy({ id });
    if (!entity) {
      throw new NotFoundException(`Próxima acción con ID ${id} no encontrada`);
    }
    Object.assign(entity, dto);
    return this.nextActionRepository.save(entity);
  }

  // --- Motivos de Pérdida ---

  async findAllLossReasons(includeInactive = false): Promise<LossReasonEntity[]> {
    return this.lossReasonRepository.find({
      where: includeInactive ? {} : { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async createLossReason(dto: CreateLossReasonDto): Promise<LossReasonEntity> {
    const existing = await this.lossReasonRepository.findOneBy({ name: dto.name });
    if (existing) {
      throw new ConflictException(`Ya existe un motivo de pérdida llamado "${dto.name}"`);
    }
    const entity = this.lossReasonRepository.create({
      name: dto.name,
      sortOrder: dto.sortOrder ?? 0,
      isActive: true,
    });
    return this.lossReasonRepository.save(entity);
  }

  async updateLossReason(id: string, dto: UpdateLossReasonDto): Promise<LossReasonEntity> {
    const entity = await this.lossReasonRepository.findOneBy({ id });
    if (!entity) {
      throw new NotFoundException(`Motivo de pérdida con ID ${id} no encontrado`);
    }
    if (dto.name && dto.name !== entity.name) {
      const existing = await this.lossReasonRepository.findOneBy({ name: dto.name });
      if (existing && existing.id !== id) {
        throw new ConflictException(`Ya existe un motivo de pérdida llamado "${dto.name}"`);
      }
    }
    Object.assign(entity, dto);
    return this.lossReasonRepository.save(entity);
  }

  // --- SLA Comercial ---

  async findAllSlaPolicies(): Promise<SlaPolicyEntity[]> {
    return this.slaPolicyRepository.find({
      relations: ['subscriptionStatus'],
      order: { subscriptionStatus: { sortOrder: 'ASC' } },
    });
  }

  /**
   * Crea o actualiza la política del estado indicado — hay como mucho una
   * fila por estado (subscription_status_id es UNIQUE), así que "agregar"
   * una política para un estado que ya tiene una simplemente la actualiza.
   */
  async upsertSlaPolicy(dto: UpsertSlaPolicyDto): Promise<SlaPolicyEntity> {
    const status = await this.subscriptionStatusRepository.findOneBy({ id: dto.subscriptionStatusId });
    if (!status) {
      throw new NotFoundException(`Estado de suscripción con ID ${dto.subscriptionStatusId} no encontrado`);
    }

    let policy = await this.slaPolicyRepository.findOneBy({ subscriptionStatusId: dto.subscriptionStatusId });
    if (policy) {
      policy.maxDaysWithoutActivity = dto.maxDaysWithoutActivity;
      if (dto.isActive !== undefined) policy.isActive = dto.isActive;
    } else {
      policy = this.slaPolicyRepository.create({
        subscriptionStatusId: dto.subscriptionStatusId,
        maxDaysWithoutActivity: dto.maxDaysWithoutActivity,
        isActive: dto.isActive ?? true,
      });
    }
    return this.slaPolicyRepository.save(policy);
  }

  private async generateUniqueCode(
    repository: Repository<SubscriptionStatusEntity> | Repository<NextActionEntity>,
    name: string,
    maxLength: number,
  ): Promise<string> {
    const base = slugToCode(name, maxLength);
    let candidate = base;
    let suffix = 2;
    while (await (repository as Repository<any>).findOneBy({ code: candidate })) {
      const suffixStr = `_${suffix}`;
      candidate = `${base.slice(0, maxLength - suffixStr.length)}${suffixStr}`;
      suffix += 1;
    }
    return candidate;
  }
}
