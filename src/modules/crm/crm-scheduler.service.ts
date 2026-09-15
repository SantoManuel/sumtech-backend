import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { OpportunityEntity } from './entities/opportunity.entity';
import { UserEntity } from '../users/entities/user.entity';
import { SatisfactionSurveyEntity } from './entities/satisfaction-survey.entity';
import { NEXT_ACTION_CODE } from './entities/next-action.entity';
import { SUBSCRIPTION_STATUS_CODE } from './entities/subscription-status.entity';
import { CrmService } from './crm.service';
import { MailService } from '../mail/mail.service';

const ROUND_ROBIN_ROLE = 'AGENTE_CRM';
const SURVEY_EXPIRY_DAYS = 7;

/**
 * Automatizaciones diarias del CRM (Fase 3): recordatorio de próxima acción,
 * alerta de SLA en riesgo, y envío real de la encuesta de satisfacción.
 * Todo por correo (MailModule) — resiliente: si el correo no está
 * configurado o falla, se loguea y el resto del sistema sigue funcionando.
 */
@Injectable()
export class CrmSchedulerService {
  private readonly logger = new Logger(CrmSchedulerService.name);

  constructor(
    @InjectRepository(OpportunityEntity)
    private readonly opportunityRepository: Repository<OpportunityEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(SatisfactionSurveyEntity)
    private readonly surveyRepository: Repository<SatisfactionSurveyEntity>,
    private readonly crmService: CrmService,
    private readonly mailService: MailService,
  ) {}

  private async getActiveCrmAgents(): Promise<UserEntity[]> {
    return this.userRepository
      .createQueryBuilder('u')
      .innerJoin('u.roles', 'r')
      .where('r.name = :role', { role: ROUND_ROBIN_ROLE })
      .andWhere('u.isActive = true')
      .getMany();
  }

  private getCrmUrl(): string {
    return `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/crm`;
  }

  /**
   * Recordatorio diario 8:00am — a cada agente activo, sus oportunidades con
   * próxima acción vencida o que vence hoy.
   */
  @Cron('0 8 * * *')
  async sendDailyReminders(): Promise<void> {
    const agents = await this.getActiveCrmAgents();
    for (const agent of agents) {
      if (!agent.email) continue;

      const opportunities = await this.opportunityRepository
        .createQueryBuilder('o')
        .leftJoinAndSelect('o.subscriptionStatus', 'status')
        .leftJoinAndSelect('o.nextAction', 'nextAction')
        .where('o.assignedUserId = :agentId', { agentId: agent.id })
        .andWhere('status.code NOT IN (:...terminal)', {
          terminal: [SUBSCRIPTION_STATUS_CODE.SUSCRIPCION_ACTIVA, SUBSCRIPTION_STATUS_CODE.PERDIDA],
        })
        .andWhere('o.nextActionDate IS NOT NULL')
        .andWhere('o.nextActionDate <= CURRENT_DATE')
        .getMany();

      if (opportunities.length === 0) continue;

      const sent = await this.mailService.sendTemplatedMail({
        to: agent.email,
        subject: `Sumtech CRM — ${opportunities.length} acción(es) pendiente(s) hoy`,
        template: 'crm-reminder',
        context: {
          agentName: agent.username,
          count: opportunities.length,
          crmUrl: this.getCrmUrl(),
          opportunities: opportunities.map((o) => ({
            name: o.name,
            nextActionName: o.nextAction?.name || 'Sin acción definida',
            nextActionDate: o.nextActionDate,
            overdue: !!o.nextActionDate && o.nextActionDate < new Date().toISOString().slice(0, 10),
          })),
        },
      });

      this.logger.log(
        `Recordatorio diario para ${agent.username}: ${opportunities.length} oportunidad(es), correo ${sent ? 'enviado' : 'NO enviado (ver log anterior)'}`,
      );
    }
  }

  /** Alerta de SLA en riesgo 9:00am — a cada agente activo, sus oportunidades que exceden el SLA de su estado. */
  @Cron('0 9 * * *')
  async sendSlaBreachAlerts(): Promise<void> {
    const breaches = await this.crmService.findSlaBreaches();
    if (breaches.length === 0) return;

    const breachesByAgentId = new Map<string, typeof breaches>();
    for (const breach of breaches) {
      const agentId = breach.opportunity.assignedUserId;
      if (!agentId) continue;
      const list = breachesByAgentId.get(agentId) || [];
      list.push(breach);
      breachesByAgentId.set(agentId, list);
    }

    for (const [agentId, agentBreaches] of breachesByAgentId) {
      const agent = await this.userRepository.findOneBy({ id: agentId });
      if (!agent?.email) continue;

      const sent = await this.mailService.sendTemplatedMail({
        to: agent.email,
        subject: `Sumtech CRM — ${agentBreaches.length} oportunidad(es) exceden el SLA`,
        template: 'crm-sla-alert',
        context: {
          agentName: agent.username,
          count: agentBreaches.length,
          crmUrl: this.getCrmUrl(),
          opportunities: agentBreaches.map((b) => ({
            name: b.opportunity.name,
            statusName: b.opportunity.subscriptionStatus.name,
            daysSinceUpdate: b.daysSinceUpdate,
            maxDays: b.maxDays,
          })),
        },
      });

      this.logger.log(
        `Alerta de SLA para ${agent.username}: ${agentBreaches.length} oportunidad(es), correo ${sent ? 'enviado' : 'NO enviado (ver log anterior)'}`,
      );
    }
  }

  /**
   * Envío real de la encuesta de satisfacción 10:00am — para las
   * oportunidades ya cerradas cuya "próxima acción" agendada al cierre
   * (ENVIAR_ENCUESTA, +3 días) ya venció. Genera el enlace de un solo uso y
   * limpia la próxima acción para no reenviarla mañana.
   */
  @Cron('0 10 * * *')
  async sendSatisfactionSurveys(): Promise<void> {
    const dueOpportunities = await this.opportunityRepository
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.nextAction', 'nextAction')
      .leftJoinAndSelect('o.client', 'client')
      .where('nextAction.code = :code', { code: NEXT_ACTION_CODE.ENVIAR_ENCUESTA })
      .andWhere('o.nextActionDate IS NOT NULL')
      .andWhere('o.nextActionDate <= CURRENT_DATE')
      .andWhere('o.clientId IS NOT NULL')
      .getMany();

    for (const opportunity of dueOpportunities) {
      if (!opportunity.client?.email) {
        this.logger.warn(`Oportunidad ${opportunity.id} sin email de cliente — no se puede enviar la encuesta.`);
        continue;
      }

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + SURVEY_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      const survey = this.surveyRepository.create({
        opportunityId: opportunity.id,
        token,
        status: 'PENDING',
        sentAt: new Date(),
        expiresAt,
      });
      await this.surveyRepository.save(survey);

      const surveyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/encuesta/${token}`;
      const sent = await this.mailService.sendTemplatedMail({
        to: opportunity.client.email,
        subject: 'Sumtech — Cuéntanos cómo fue tu experiencia',
        template: 'crm-satisfaction-survey',
        context: { clientName: opportunity.client.name, surveyUrl },
      });

      // Se limpia la próxima acción independientemente de si el correo salió o
      // no: reintentar indefinidamente cada día no es el comportamiento
      // deseado (el agente puede reenviar el enlace manualmente si hace falta).
      await this.opportunityRepository.update(opportunity.id, { nextActionId: null, nextActionDate: null });

      this.logger.log(`Encuesta de satisfacción para "${opportunity.name}": correo ${sent ? 'enviado' : 'NO enviado (ver log anterior)'}`);
    }
  }
}
