import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { OpportunityEntity } from '../crm/entities/opportunity.entity';
import { SubscriptionStatusEntity, SUBSCRIPTION_STATUS_CODE } from '../crm/entities/subscription-status.entity';
import { AiChatbotClientService, AiChatbotResponse } from '../ai-chatbot/ai-chatbot-client.service';
import { StartPublicChatDto, PublicChatStartResult, PublicChatMessageResult } from './dto/public-chat.dto';

/**
 * Chat público del landing (visitantes anónimos, sin cuenta en el ERP).
 * Cada sesión de chat ES una Opportunity de CRM desde el primer mensaje — no
 * se depende de que la IA "detecte" intención de compra para crear el
 * registro, a diferencia de PortalService (chat de clientes ya autenticados).
 */
@Injectable()
export class PublicChatService {
  private readonly logger = new Logger(PublicChatService.name);

  /**
   * Intents de Chatbot_sumtech que se consideran señal de interés comercial
   * real — cuando aparecen, una oportunidad PROSPECTO pasa a EN_NEGOCIACION
   * para que un agente de CRM le dé seguimiento humano.
   */
  private readonly qualifyingIntents = [
    'consulta_planes_internet',
    'consulta_cobertura',
    'consulta_horarios_sucursales',
  ];

  private static readonly MAX_NOTES_LENGTH = 4000;
  private static readonly NOTE_EXCERPT_LENGTH = 200;

  constructor(
    @InjectRepository(OpportunityEntity)
    private readonly opportunityRepository: Repository<OpportunityEntity>,
    @InjectRepository(SubscriptionStatusEntity)
    private readonly subscriptionStatusRepository: Repository<SubscriptionStatusEntity>,
    private readonly aiChatbotClient: AiChatbotClientService,
  ) {}

  async startSession(dto: StartPublicChatDto): Promise<PublicChatStartResult> {
    if (dto.website) {
      // Honeypot activado: no se crea oportunidad, se devuelve un sessionId
      // inerte (nunca existirá como Opportunity real, así que /chat/message
      // fallará con 404 silenciosamente si el bot insiste en usarlo).
      this.logger.warn('Honeypot de /public/chat/start activado — solicitud descartada silenciosamente.');
      return { sessionId: randomUUID(), isReturning: false };
    }

    const normalizedPhone = this.normalizePhone(dto.phone);

    const existing = await this.opportunityRepository.findOne({
      where: {
        phone: normalizedPhone,
        subscriptionStatus: {
          code: In([SUBSCRIPTION_STATUS_CODE.PROSPECTO, SUBSCRIPTION_STATUS_CODE.EN_NEGOCIACION]),
        },
      },
      order: { createdAt: 'DESC' },
    });

    if (existing) {
      return { sessionId: existing.id, isReturning: true };
    }

    const prospectoStatus = await this.getStatusByCodeOrFail(SUBSCRIPTION_STATUS_CODE.PROSPECTO);
    const now = new Date();
    const opportunity = this.opportunityRepository.create({
      name: dto.name.trim(),
      phone: normalizedPhone,
      email: dto.email?.trim().toLowerCase(),
      source: 'WEB_CHATBOT',
      subscriptionStatusId: prospectoStatus.id,
      notes: 'Conversación iniciada vía widget de chat del sitio web.',
      firstContactAt: now,
    });
    const saved = await this.opportunityRepository.save(opportunity);
    return { sessionId: saved.id, isReturning: false };
  }

  async sendMessage(sessionId: string, message: string): Promise<PublicChatMessageResult> {
    const opportunity = await this.opportunityRepository.findOne({
      where: { id: sessionId },
      relations: ['subscriptionStatus'],
    });
    if (!opportunity) {
      throw new NotFoundException('Sesión de chat no encontrada. Por favor inicia una nueva conversación.');
    }

    try {
      const ai = await this.aiChatbotClient.sendMessage(sessionId, message, opportunity.name);
      await this.updateOpportunityFromAiSignal(opportunity, ai, message);

      return {
        message: ai.response,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.warn(
        `Chatbot_sumtech no disponible para sesión pública ${sessionId}: ${(err as Error).message}`,
      );
      return {
        message:
          'Gracias por tu mensaje. En este momento nuestro asistente está ocupado — un asesor de Sumtech te contactará pronto al número que nos dejaste.',
        timestamp: new Date().toISOString(),
      };
    }
  }

  private async updateOpportunityFromAiSignal(
    opportunity: OpportunityEntity,
    ai: AiChatbotResponse,
    userMessage: string,
  ): Promise<void> {
    const shouldQualify = ai.escalated || (!!ai.intent && this.qualifyingIntents.includes(ai.intent));

    if (shouldQualify && opportunity.subscriptionStatus.code === SUBSCRIPTION_STATUS_CODE.PROSPECTO) {
      const enNegociacionStatus = await this.getStatusByCodeOrFail(SUBSCRIPTION_STATUS_CODE.EN_NEGOCIACION);
      opportunity.subscriptionStatusId = enNegociacionStatus.id;
    }

    const excerptMsg = userMessage.slice(0, PublicChatService.NOTE_EXCERPT_LENGTH);
    const excerptResp = ai.response.slice(0, PublicChatService.NOTE_EXCERPT_LENGTH);
    const newLine = `\n[Chat] Cliente: "${excerptMsg}" | Bot: "${excerptResp}"`;
    opportunity.notes = `${opportunity.notes ?? ''}${newLine}`.slice(-PublicChatService.MAX_NOTES_LENGTH);

    await this.opportunityRepository.save(opportunity);
  }

  private async getStatusByCodeOrFail(code: string): Promise<SubscriptionStatusEntity> {
    const status = await this.subscriptionStatusRepository.findOneBy({ code });
    if (!status) {
      throw new Error(
        `El catálogo de estados de suscripción no tiene configurado el código "${code}". Verifica que la migración 046 se haya aplicado.`,
      );
    }
    return status;
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/[\s\-()]/g, '');
  }
}
