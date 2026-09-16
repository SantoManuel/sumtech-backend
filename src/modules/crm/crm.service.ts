import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpportunityEntity } from './entities/opportunity.entity';
import { InteractionEntity } from './entities/interaction.entity';
import { SubscriptionStatusEntity, SUBSCRIPTION_STATUS_CODE } from './entities/subscription-status.entity';
import { NextActionEntity, NEXT_ACTION_CODE } from './entities/next-action.entity';
import { LossReasonEntity } from './entities/loss-reason.entity';
import { RoundRobinCursorEntity } from './entities/round-robin-cursor.entity';
import { OpportunityStateHistoryEntity } from './entities/opportunity-state-history.entity';
import { SlaPolicyEntity } from './entities/sla-policy.entity';
import { SatisfactionSurveyEntity } from './entities/satisfaction-survey.entity';
import { UserEntity } from '../users/entities/user.entity';
import {
  CreateOpportunityDto,
  UpdateOpportunityDto,
  UpdateOpportunityStatusDto,
  CreateInteractionDto,
  FilterOpportunityDto,
} from './dto/crm.dto';
import { CloseOpportunityDto } from './dto/close-opportunity.dto';
import { ClientsService } from '../clients/clients.service';
import { AiChatbotClientService, AiChatbotConversation } from '../ai-chatbot/ai-chatbot-client.service';

const ROUND_ROBIN_ROLE = 'AGENTE_CRM';
const ROUND_ROBIN_SURVEY_DELAY_DAYS = 3;

@Injectable()
export class CrmService {
  constructor(
    @InjectRepository(OpportunityEntity)
    private readonly opportunityRepository: Repository<OpportunityEntity>,
    @InjectRepository(InteractionEntity)
    private readonly interactionRepository: Repository<InteractionEntity>,
    @InjectRepository(SubscriptionStatusEntity)
    private readonly subscriptionStatusRepository: Repository<SubscriptionStatusEntity>,
    @InjectRepository(NextActionEntity)
    private readonly nextActionRepository: Repository<NextActionEntity>,
    @InjectRepository(LossReasonEntity)
    private readonly lossReasonRepository: Repository<LossReasonEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(RoundRobinCursorEntity)
    private readonly cursorRepository: Repository<RoundRobinCursorEntity>,
    @InjectRepository(OpportunityStateHistoryEntity)
    private readonly stateHistoryRepository: Repository<OpportunityStateHistoryEntity>,
    @InjectRepository(SlaPolicyEntity)
    private readonly slaPolicyRepository: Repository<SlaPolicyEntity>,
    @InjectRepository(SatisfactionSurveyEntity)
    private readonly surveyRepository: Repository<SatisfactionSurveyEntity>,
    private readonly clientsService: ClientsService,
    private readonly aiChatbotClient: AiChatbotClientService,
  ) {}

  private static readonly OPPORTUNITY_RELATIONS = [
    'plan',
    'subscriptionStatus',
    'nextAction',
    'assignedUser',
    'lossReason',
  ];

  // ---------------------------------------------------------------------
  // Catálogos — lookups internos usados por las reglas de negocio de abajo.
  // ---------------------------------------------------------------------

  private async getStatusByCodeOrFail(code: string): Promise<SubscriptionStatusEntity> {
    const status = await this.subscriptionStatusRepository.findOneBy({ code });
    if (!status) {
      // Esto solo puede pasar si el seed de la migración 046 no corrió — es un
      // error de configuración del servidor, no una entrada inválida del usuario.
      throw new InternalServerErrorException(
        `El catálogo de estados de suscripción no tiene configurado el código "${code}". Verifica que la migración 046 se haya aplicado.`,
      );
    }
    return status;
  }

  private async getNextActionByCode(code: string): Promise<NextActionEntity | null> {
    return this.nextActionRepository.findOneBy({ code });
  }

  // ---------------------------------------------------------------------
  // Round Robin — asigna la Opportunity al siguiente AGENTE_CRM activo en la
  // rotación. Nunca lanza: si no hay agentes activos, deja la oportunidad sin
  // asignar (un admin puede asignarla manualmente después) en vez de bloquear
  // la creación — crítico porque una Opportunity también nace desde el chat
  // público/landing sin que nadie esté validando la configuración del CRM en
  // ese momento.
  // ---------------------------------------------------------------------

  async assignNextAgent(): Promise<string | null> {
    const activeAgents = await this.userRepository
      .createQueryBuilder('u')
      .innerJoin('u.roles', 'r')
      .where('r.name = :role', { role: ROUND_ROBIN_ROLE })
      .andWhere('u.isActive = true')
      .orderBy('u.id', 'ASC')
      .getMany();

    if (activeAgents.length === 0) {
      return null;
    }

    const cursor = await this.cursorRepository.findOneBy({ id: 1 });
    let nextIndex = 0;
    if (cursor?.lastAssignedUserId) {
      const lastIndex = activeAgents.findIndex((agent) => agent.id === cursor.lastAssignedUserId);
      nextIndex = lastIndex === -1 ? 0 : (lastIndex + 1) % activeAgents.length;
    }

    const chosenAgent = activeAgents[nextIndex];

    if (cursor) {
      cursor.lastAssignedUserId = chosenAgent.id;
      await this.cursorRepository.save(cursor);
    } else {
      await this.cursorRepository.save(
        this.cursorRepository.create({ id: 1, lastAssignedUserId: chosenAgent.id }),
      );
    }

    return chosenAgent.id;
  }

  // ---------------------------------------------------------------------
  // Opportunities — CRUD + reglas de negocio del pipeline
  // ---------------------------------------------------------------------

  async findAll(dto: FilterOpportunityDto) {
    const page = dto.page || 1;
    const limit = dto.limit || 15;
    const skip = (page - 1) * limit;

    const query = this.opportunityRepository
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.plan', 'plan')
      .leftJoinAndSelect('o.subscriptionStatus', 'status')
      .leftJoinAndSelect('o.nextAction', 'nextAction')
      .leftJoinAndSelect('o.assignedUser', 'assignedUser')
      .leftJoinAndSelect('o.lossReason', 'lossReason')
      .skip(skip)
      .take(limit)
      .orderBy('o.createdAt', 'DESC');

    if (dto.subscriptionStatusId) {
      query.andWhere('o.subscriptionStatusId = :statusId', { statusId: dto.subscriptionStatusId });
    }
    if (dto.assignedUserId) {
      query.andWhere('o.assignedUserId = :assignedUserId', { assignedUserId: dto.assignedUserId });
    }
    if (dto.search) {
      query.andWhere('(o.name ILIKE :search OR o.phone ILIKE :search OR o.email ILIKE :search)', {
        search: `%${dto.search}%`,
      });
    }
    if (dto.overdueOnly) {
      query.andWhere('o.nextActionDate IS NOT NULL').andWhere('o.nextActionDate < CURRENT_DATE');
    }

    const [data, total] = await query.getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string): Promise<OpportunityEntity> {
    const opportunity = await this.opportunityRepository.findOne({
      where: { id },
      relations: [...CrmService.OPPORTUNITY_RELATIONS, 'client'],
    });
    if (!opportunity) {
      throw new NotFoundException(`Oportunidad con ID ${id} no encontrada`);
    }
    return opportunity;
  }

  /**
   * Crea una Opportunity nueva — punto de entrada único usado tanto por el
   * alta manual desde /dashboard/crm como por el embudo público (landing,
   * chat, WhatsApp). Siempre nace en PROSPECTO, con la próxima acción
   * sugerida "Llamar para presentación" y asignada por round robin.
   */
  async create(dto: CreateOpportunityDto, createdByUserId?: string): Promise<OpportunityEntity> {
    const prospectoStatus = await this.getStatusByCodeOrFail(SUBSCRIPTION_STATUS_CODE.PROSPECTO);
    const defaultNextAction = await this.getNextActionByCode(NEXT_ACTION_CODE.LLAMAR_PRESENTACION);
    const assignedUserId = await this.assignNextAgent();
    const now = new Date();

    const opportunity = this.opportunityRepository.create({
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      planId: dto.planId,
      source: dto.source || 'WEB_LANDING',
      notes: dto.notes,
      potentialValue: dto.potentialValue ?? 0,
      serviceInterest: dto.serviceInterest,
      installationAddress: dto.installationAddress,
      subscriptionStatusId: prospectoStatus.id,
      nextActionId: defaultNextAction?.id ?? null,
      assignedUserId: assignedUserId ?? undefined,
      firstContactAt: now,
    });

    const saved = await this.opportunityRepository.save(opportunity);
    await this.recordStateChange(saved.id, null, prospectoStatus.id, createdByUserId);
    return saved;
  }

  /**
   * Edición de campos generales — el cambio de estado tiene su propio
   * endpoint/método (ver updateStatus/closeOpportunity).
   *
   * Usa `repository.update()` (UPDATE de columnas puntuales) en vez de
   * cargar la entidad completa + `.save()`: cuando una entidad se carga con
   * una relación (ej. `nextAction`, `plan`, `assignedUser`) y luego solo se
   * reasigna la columna FK (`nextActionId`), TypeORM puede recomputar la FK a
   * partir del objeto de relación ya cargado (que sigue apuntando al valor
   * viejo) y revertir silenciosamente el cambio en el `.save()`. `update()`
   * evita esa clase de bug por completo al no tocar relaciones en absoluto.
   */
  async update(id: string, dto: UpdateOpportunityDto): Promise<OpportunityEntity> {
    await this.findById(id); // valida existencia (lanza NotFoundException si no existe)
    await this.opportunityRepository.update(id, dto);
    return this.findById(id);
  }

  /**
   * Cambia el estado de la oportunidad, salvo a SUSCRIPCION_ACTIVA (bloqueado
   * a propósito — ver closeOpportunity). Si el destino es PERDIDA, exige un
   * motivo válido y limpia la próxima acción (ya no aplica seguimiento activo).
   * Ver el comentario de `update()` sobre por qué se usa `repository.update()`
   * en vez de cargar + mutar + `.save()` la entidad completa.
   */
  async updateStatus(id: string, dto: UpdateOpportunityStatusDto, changedByUserId?: string): Promise<OpportunityEntity> {
    const current = await this.findById(id);
    const targetStatus = await this.subscriptionStatusRepository.findOneBy({ id: dto.subscriptionStatusId });
    if (!targetStatus) {
      throw new NotFoundException(`Estado de suscripción con ID ${dto.subscriptionStatusId} no encontrado`);
    }

    if (targetStatus.code === SUBSCRIPTION_STATUS_CODE.SUSCRIPCION_ACTIVA) {
      throw new BadRequestException(
        'Para pasar a Suscripción Activa usa el cierre de la oportunidad (crea el cliente y el contrato) en vez de cambiar el estado directamente.',
      );
    }

    const updatePayload: Partial<OpportunityEntity> = { subscriptionStatusId: targetStatus.id };

    if (targetStatus.code === SUBSCRIPTION_STATUS_CODE.PERDIDA) {
      if (!dto.lossReasonId) {
        throw new BadRequestException('Debes indicar el motivo de pérdida para marcar la oportunidad como Pérdida.');
      }
      const reason = await this.lossReasonRepository.findOneBy({ id: dto.lossReasonId });
      if (!reason) {
        throw new NotFoundException(`Motivo de pérdida con ID ${dto.lossReasonId} no encontrado`);
      }
      updatePayload.lossReasonId = dto.lossReasonId;
      updatePayload.nextActionId = null;
      updatePayload.nextActionDate = null;
    }

    await this.opportunityRepository.update(id, updatePayload);
    await this.recordStateChange(id, current.subscriptionStatusId, targetStatus.id, changedByUserId);
    return this.findById(id);
  }

  /**
   * Cierra la oportunidad: crea el Client real (con cédula/RNC, que hasta
   * ahora el prospecto no había dado) y el Contract del plan elegido —
   * ClientsService.addContract() ya dispara CONTRACT_CREATED, que
   * ContractCreatedListener escucha para despachar automáticamente el ticket
   * de instalación (HIGH). No se crea ningún ticket manualmente aquí.
   * Deliberadamente NO envuelve las dos llamadas a ClientsService en una única
   * transacción de base de datos (requeriría refactorizar ClientsService para
   * aceptar un EntityManager externo): si `addContract` falla después de que
   * el Client ya se creó, el Client queda registrado sin contrato — un estado
   * recuperable manualmente desde /dashboard/clientes/:id ("Nuevo Contrato"),
   * no uno corrupto.
   */
  async closeOpportunity(
    id: string,
    dto: CloseOpportunityDto,
    closedByUserId?: string,
  ): Promise<{ opportunity: OpportunityEntity; clientId: string; contractId: string }> {
    const opportunity = await this.findById(id);

    if (opportunity.subscriptionStatus.code === SUBSCRIPTION_STATUS_CODE.SUSCRIPCION_ACTIVA) {
      throw new BadRequestException('Esta oportunidad ya está cerrada como Suscripción Activa.');
    }
    if (opportunity.subscriptionStatus.code === SUBSCRIPTION_STATUS_CODE.PERDIDA) {
      throw new BadRequestException('No se puede cerrar una oportunidad marcada como Pérdida — cámbiala de estado primero.');
    }

    const planId = dto.planId || opportunity.planId;
    if (!planId) {
      throw new BadRequestException('Debes indicar el plan a contratar (la oportunidad no tiene uno asociado).');
    }

    const client = await this.clientsService.create({
      clientType: dto.clientType,
      name: opportunity.name,
      docType: dto.docType,
      docNumber: dto.docNumber,
      email: dto.email || opportunity.email || `prospecto_${Date.now()}@sumtech.com.do`,
      phone: dto.phone || opportunity.phone,
      address: dto.address,
    });

    const addressId = client.addresses?.[0]?.id;
    if (!addressId) {
      throw new InternalServerErrorException('El cliente se creó pero no se pudo determinar la dirección para el contrato.');
    }

    const contract = await this.clientsService.addContract(client.id, planId, addressId, dto.billingDay);

    const activaStatus = await this.getStatusByCodeOrFail(SUBSCRIPTION_STATUS_CODE.SUSCRIPCION_ACTIVA);
    const surveyAction = await this.getNextActionByCode(NEXT_ACTION_CODE.ENVIAR_ENCUESTA);
    const surveyDate = new Date();
    surveyDate.setDate(surveyDate.getDate() + ROUND_ROBIN_SURVEY_DELAY_DAYS);

    // `repository.update()` en vez de mutar + `.save()` la entidad cargada al
    // inicio del método — ver el comentario de update()/updateStatus() sobre
    // por qué (relaciones cargadas y ya-obsoletas revirtiendo la FK en el save).
    await this.opportunityRepository.update(id, {
      clientId: client.id,
      subscriptionStatusId: activaStatus.id,
      nextActionId: surveyAction?.id ?? null,
      nextActionDate: surveyAction ? surveyDate.toISOString().slice(0, 10) : null,
    });
    await this.recordStateChange(id, opportunity.subscriptionStatusId, activaStatus.id, closedByUserId);

    return { opportunity: await this.findById(id), clientId: client.id, contractId: contract.id };
  }

  /** Historial completo de cambios de estado de una oportunidad, más reciente primero. */
  async getStateHistory(id: string): Promise<OpportunityStateHistoryEntity[]> {
    await this.findById(id); // valida existencia
    return this.stateHistoryRepository.find({
      where: { opportunityId: id },
      relations: ['previousStatus', 'newStatus', 'changedByUser'],
      order: { changedAt: 'DESC' },
    });
  }

  /**
   * SLA comercial: oportunidades en un estado no terminal que llevan más días
   * sin actividad (`lastUpdatedAt`) de los permitidos por la política de su
   * estado actual. Recorre las políticas activas (típicamente 1-2, una por
   * estado del embudo) en vez de un solo JOIN crudo — más simple de leer y el
   * costo es insignificante dado lo pequeño que es ese catálogo.
   */
  async findSlaBreaches(): Promise<Array<{ opportunity: OpportunityEntity; daysSinceUpdate: number; maxDays: number }>> {
    const policies = await this.slaPolicyRepository.find({ where: { isActive: true } });
    const results: Array<{ opportunity: OpportunityEntity; daysSinceUpdate: number; maxDays: number }> = [];

    for (const policy of policies) {
      const breached = await this.opportunityRepository
        .createQueryBuilder('o')
        .leftJoinAndSelect('o.subscriptionStatus', 'status')
        .leftJoinAndSelect('o.assignedUser', 'assignedUser')
        .where('o.subscriptionStatusId = :statusId', { statusId: policy.subscriptionStatusId })
        .andWhere('EXTRACT(DAY FROM NOW() - o.lastUpdatedAt) > :maxDays', { maxDays: policy.maxDaysWithoutActivity })
        .getMany();

      for (const opportunity of breached) {
        const daysSinceUpdate = Math.floor((Date.now() - new Date(opportunity.lastUpdatedAt).getTime()) / (1000 * 60 * 60 * 24));
        results.push({ opportunity, daysSinceUpdate, maxDays: policy.maxDaysWithoutActivity });
      }
    }

    return results;
  }

  /** Resultados de encuestas de satisfacción ya respondidas, más reciente primero, con el promedio de calificación. */
  async getSatisfactionSurveys(): Promise<{ surveys: SatisfactionSurveyEntity[]; averageRating: number }> {
    const surveys = await this.surveyRepository.find({
      where: { status: 'SUBMITTED' },
      relations: ['opportunity'],
      order: { submittedAt: 'DESC' },
    });
    const ratings = surveys.map((s) => s.rating).filter((r): r is number => typeof r === 'number');
    const averageRating = ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100 : 0;
    return { surveys, averageRating };
  }

  private async recordStateChange(
    opportunityId: string,
    previousStatusId: string | null,
    newStatusId: string,
    changedByUserId?: string,
  ): Promise<void> {
    const history = this.stateHistoryRepository.create({
      opportunityId,
      previousStatusId: previousStatusId ?? undefined,
      newStatusId,
      changedByUserId,
    });
    await this.stateHistoryRepository.save(history);
  }

  // ---------------------------------------------------------------------
  // Interacciones / actividades / conversación de WhatsApp
  // ---------------------------------------------------------------------

  async findInteractionsByClient(clientId: string) {
    return this.interactionRepository.find({
      where: { clientId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  /** Actividades registradas directamente sobre una Opportunity (antes de que exista un Client formal). */
  async findInteractionsByOpportunity(opportunityId: string) {
    await this.findById(opportunityId); // valida existencia
    return this.interactionRepository.find({
      where: { opportunityId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Registra una actividad (llamada, nota, visita) — debe estar ligada a un
   * Client ya formal, a una Opportunity todavía en el embudo, o a ambos (una
   * vez cerrada). Al menos uno de los dos es obligatorio (lo valida el
   * DTO/controller vía `@ValidateIf`, y la constraint de BD lo refuerza).
   */
  async createInteraction(userId: string, dto: CreateInteractionDto): Promise<InteractionEntity> {
    if (!dto.clientId && !dto.opportunityId) {
      throw new BadRequestException('Debes indicar clientId, opportunityId, o ambos.');
    }
    if (dto.opportunityId) {
      await this.findById(dto.opportunityId); // valida que la oportunidad exista
    }
    const interaction = this.interactionRepository.create({
      clientId: dto.clientId,
      opportunityId: dto.opportunityId,
      userId,
      channel: dto.channel,
      subject: dto.subject,
      notes: dto.notes,
    });
    return this.interactionRepository.save(interaction);
  }

  /**
   * Trae la conversación de WhatsApp de la oportunidad con el bot/agente,
   * tabulada para /dashboard/crm — vive en el proyecto separado
   * `Chatbot_sumtech`, no en este backend. `externalId` allá se guarda solo
   * con dígitos (sin "+" ni sufijos de WhatsApp), así que se normaliza el
   * teléfono antes de pedirla.
   */
  async getOpportunityConversation(id: string): Promise<{ found: boolean; conversation: AiChatbotConversation | null }> {
    const opportunity = await this.findById(id);
    const normalizedPhone = opportunity.phone.replace(/\D/g, '');
    const conversation = await this.aiChatbotClient.getConversationByPhone(normalizedPhone);
    return { found: !!conversation, conversation };
  }

  async recordSaleInteraction(clientId: string, ncfNumber: string, grandTotal: number, userId?: string) {
    // Buscar un usuario del sistema o usar el que generó la venta
    const interaction = this.interactionRepository.create({
      clientId,
      userId: userId || '00000000-0000-0000-0000-000000000000',
      channel: 'SYSTEM_EVENT',
      subject: `Venta Confirmada - Factura ${ncfNumber}`,
      notes: `Compra realizada por un total de RD$ ${grandTotal.toLocaleString()}. Factura electrónica DGII ${ncfNumber} timbrada exitosamente.`,
    });
    return this.interactionRepository.save(interaction);
  }

  // ---------------------------------------------------------------------
  // Dashboard comercial
  // ---------------------------------------------------------------------

  /**
   * Métricas agregadas del pipeline para /dashboard/crm — valor del pipeline
   * por estado, suscripciones cerradas del mes, tasa de conversión (ganadas
   * vs. ganadas+perdidas, no cuenta lo que sigue abierto), pérdidas por
   * motivo, actividades por responsable y ticket promedio de lo ya ganado.
   */
  async getDashboardMetrics() {
    const pipelineByStatusRaw = await this.opportunityRepository
      .createQueryBuilder('o')
      .innerJoin('o.subscriptionStatus', 'status')
      .select('status.id', 'statusId')
      .addSelect('status.code', 'statusCode')
      .addSelect('status.name', 'statusName')
      .addSelect('COUNT(o.id)', 'count')
      .addSelect('COALESCE(SUM(o.potentialValue), 0)', 'totalValue')
      .groupBy('status.id')
      .addGroupBy('status.code')
      .addGroupBy('status.name')
      .orderBy('status.sortOrder', 'ASC')
      .getRawMany();

    const closedThisMonth = await this.stateHistoryRepository
      .createQueryBuilder('h')
      .innerJoin('h.newStatus', 'status')
      .where('status.code = :code', { code: SUBSCRIPTION_STATUS_CODE.SUSCRIPCION_ACTIVA })
      .andWhere("h.changedAt >= date_trunc('month', CURRENT_DATE)")
      .getCount();

    const wonRaw = await this.stateHistoryRepository
      .createQueryBuilder('h')
      .innerJoin('h.newStatus', 'status')
      .where('status.code = :code', { code: SUBSCRIPTION_STATUS_CODE.SUSCRIPCION_ACTIVA })
      .select('COUNT(DISTINCT h.opportunityId)', 'count')
      .getRawOne();

    const lostRaw = await this.stateHistoryRepository
      .createQueryBuilder('h')
      .innerJoin('h.newStatus', 'status')
      .where('status.code = :code', { code: SUBSCRIPTION_STATUS_CODE.PERDIDA })
      .select('COUNT(DISTINCT h.opportunityId)', 'count')
      .getRawOne();

    const wonCount = Number(wonRaw?.count || 0);
    const lostCount = Number(lostRaw?.count || 0);
    const conversionRate = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 10000) / 100 : 0;

    const lossesByReasonRaw = await this.opportunityRepository
      .createQueryBuilder('o')
      .innerJoin('o.lossReason', 'reason')
      .select('reason.name', 'reasonName')
      .addSelect('COUNT(o.id)', 'count')
      .groupBy('reason.name')
      .orderBy('count', 'DESC')
      .getRawMany();

    const activitiesByUserRaw = await this.interactionRepository
      .createQueryBuilder('i')
      .innerJoin('i.user', 'u')
      .select('u.username', 'username')
      .addSelect('COUNT(i.id)', 'count')
      .groupBy('u.username')
      .orderBy('count', 'DESC')
      .getRawMany();

    const averageTicketRaw = await this.opportunityRepository
      .createQueryBuilder('o')
      .innerJoin('o.subscriptionStatus', 'status')
      .where('status.code = :code', { code: SUBSCRIPTION_STATUS_CODE.SUSCRIPCION_ACTIVA })
      .select('COALESCE(AVG(o.potentialValue), 0)', 'avg')
      .getRawOne();

    return {
      pipelineByStatus: pipelineByStatusRaw.map((r: any) => ({
        statusId: r.statusId,
        statusCode: r.statusCode,
        statusName: r.statusName,
        count: Number(r.count),
        totalValue: Number(r.totalValue),
      })),
      closedThisMonth,
      conversionRate,
      wonCount,
      lostCount,
      lossesByReason: lossesByReasonRaw.map((r: any) => ({ reasonName: r.reasonName, count: Number(r.count) })),
      activitiesByUser: activitiesByUserRaw.map((r: any) => ({ username: r.username, count: Number(r.count) })),
      averageTicket: Number(averageTicketRaw?.avg || 0),
    };
  }
}
