import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { LeadEntity } from '../crm/entities/lead.entity';
import { AiChatbotClientService, AiChatbotResponse } from '../ai-chatbot/ai-chatbot-client.service';
import { StartPublicChatDto, PublicChatStartResult, PublicChatMessageResult } from './dto/public-chat.dto';

/**
 * Chat público del landing (visitantes anónimos, sin cuenta en el ERP).
 * Cada sesión de chat ES un Lead de CRM desde el primer mensaje — no se
 * depende de que la IA "detecte" intención de compra para crear el registro,
 * a diferencia de PortalService (chat de clientes ya autenticados).
 */
@Injectable()
export class PublicChatService {
  private readonly logger = new Logger(PublicChatService.name);

  /**
   * Intents de Chatbot_sumtech que se consideran señal de interés comercial
   * real — cuando aparecen, un lead NEW pasa a CONTACTED para que un agente
   * de CRM le dé seguimiento humano.
   */
  private readonly qualifyingIntents = [
    'consulta_planes_internet',
    'consulta_cobertura',
    'consulta_horarios_sucursales',
  ];

  private static readonly MAX_NOTES_LENGTH = 4000;
  private static readonly NOTE_EXCERPT_LENGTH = 200;

  constructor(
    @InjectRepository(LeadEntity)
    private readonly leadRepository: Repository<LeadEntity>,
    private readonly aiChatbotClient: AiChatbotClientService,
  ) {}

  async startSession(dto: StartPublicChatDto): Promise<PublicChatStartResult> {
    if (dto.website) {
      // Honeypot activado: no se crea lead, se devuelve un sessionId inerte
      // (nunca existirá como Lead real, así que /chat/message fallará con
      // 404 silenciosamente si el bot insiste en usarlo).
      this.logger.warn('Honeypot de /public/chat/start activado — solicitud descartada silenciosamente.');
      return { sessionId: randomUUID(), isReturning: false };
    }

    const normalizedPhone = this.normalizePhone(dto.phone);

    const existing = await this.leadRepository.findOne({
      where: {
        phone: normalizedPhone,
        status: In(['NEW', 'CONTACTED', 'QUALIFIED']),
      },
      order: { createdAt: 'DESC' },
    });

    if (existing) {
      return { sessionId: existing.id, isReturning: true };
    }

    const lead = this.leadRepository.create({
      name: dto.name.trim(),
      phone: normalizedPhone,
      email: dto.email?.trim().toLowerCase(),
      source: 'WEB_CHATBOT',
      status: 'NEW',
      notes: 'Conversación iniciada vía widget de chat del sitio web.',
    });
    const saved = await this.leadRepository.save(lead);
    return { sessionId: saved.id, isReturning: false };
  }

  async sendMessage(sessionId: string, message: string): Promise<PublicChatMessageResult> {
    const lead = await this.leadRepository.findOneBy({ id: sessionId });
    if (!lead) {
      throw new NotFoundException('Sesión de chat no encontrada. Por favor inicia una nueva conversación.');
    }

    try {
      const ai = await this.aiChatbotClient.sendMessage(sessionId, message, lead.name);
      await this.updateLeadFromAiSignal(lead, ai, message);

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

  private async updateLeadFromAiSignal(lead: LeadEntity, ai: AiChatbotResponse, userMessage: string): Promise<void> {
    const shouldQualify = ai.escalated || (!!ai.intent && this.qualifyingIntents.includes(ai.intent));

    if (shouldQualify && lead.status === 'NEW') {
      lead.status = 'CONTACTED';
    }

    const excerptMsg = userMessage.slice(0, PublicChatService.NOTE_EXCERPT_LENGTH);
    const excerptResp = ai.response.slice(0, PublicChatService.NOTE_EXCERPT_LENGTH);
    const newLine = `\n[Chat] Cliente: "${excerptMsg}" | Bot: "${excerptResp}"`;
    lead.notes = `${lead.notes ?? ''}${newLine}`.slice(-PublicChatService.MAX_NOTES_LENGTH);

    await this.leadRepository.save(lead);
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/[\s\-()]/g, '');
  }
}
