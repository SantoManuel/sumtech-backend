import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PublicChatService } from './public-chat.service';
import { OpportunityEntity } from '../crm/entities/opportunity.entity';
import { SubscriptionStatusEntity, SUBSCRIPTION_STATUS_CODE } from '../crm/entities/subscription-status.entity';
import { AiChatbotClientService } from '../ai-chatbot/ai-chatbot-client.service';
import { StartPublicChatDto } from './dto/public-chat.dto';

describe('PublicChatService', () => {
  let service: PublicChatService;
  let opportunityRepo: any;
  let subscriptionStatusRepo: any;
  let aiChatbotClient: any;

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const PROSPECTO = { id: 'status-prospecto', code: SUBSCRIPTION_STATUS_CODE.PROSPECTO, name: 'Prospecto' };
  const EN_NEGOCIACION = { id: 'status-en-negociacion', code: SUBSCRIPTION_STATUS_CODE.EN_NEGOCIACION, name: 'En Negociación' };

  beforeEach(async () => {
    opportunityRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto: any) => ({ ...dto })),
      save: jest.fn((entity: any) => Promise.resolve({ id: entity.id ?? 'opportunity-generated', ...entity })),
    };
    subscriptionStatusRepo = {
      findOneBy: jest.fn(({ code }: { code: string }) => {
        if (code === SUBSCRIPTION_STATUS_CODE.PROSPECTO) return Promise.resolve(PROSPECTO);
        if (code === SUBSCRIPTION_STATUS_CODE.EN_NEGOCIACION) return Promise.resolve(EN_NEGOCIACION);
        return Promise.resolve(null);
      }),
    };
    aiChatbotClient = {
      sendMessage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicChatService,
        { provide: getRepositoryToken(OpportunityEntity), useValue: opportunityRepo },
        { provide: getRepositoryToken(SubscriptionStatusEntity), useValue: subscriptionStatusRepo },
        { provide: AiChatbotClientService, useValue: aiChatbotClient },
      ],
    }).compile();

    service = module.get<PublicChatService>(PublicChatService);
  });

  const validDto = (overrides: Partial<StartPublicChatDto> = {}): StartPublicChatDto => ({
    name: 'Carlos Mendoza',
    phone: '809-521-0288',
    ...overrides,
  });

  describe('startSession', () => {
    it('crea una oportunidad nueva con source WEB_CHATBOT y estado PROSPECTO cuando no existe una activa con ese teléfono', async () => {
      opportunityRepo.findOne.mockResolvedValue(null);

      const result = await service.startSession(validDto());

      expect(opportunityRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Carlos Mendoza',
          phone: '8095210288',
          source: 'WEB_CHATBOT',
          subscriptionStatusId: PROSPECTO.id,
        }),
      );
      expect(opportunityRepo.save).toHaveBeenCalled();
      expect(result.isReturning).toBe(false);
      expect(result.sessionId).toBe('opportunity-generated');
    });

    it('reusa la oportunidad existente (mismo sessionId, isReturning true) cuando ya hay una activa con el mismo teléfono normalizado', async () => {
      opportunityRepo.findOne.mockResolvedValue({ id: 'opportunity-existente', phone: '8095210288', subscriptionStatus: EN_NEGOCIACION });

      const result = await service.startSession(validDto({ phone: '(809) 521-0288' }));

      expect(result).toEqual({ sessionId: 'opportunity-existente', isReturning: true });
      expect(opportunityRepo.create).not.toHaveBeenCalled();
      expect(opportunityRepo.save).not.toHaveBeenCalled();
    });

    it('consulta findOne filtrando solo por los códigos de estado PROSPECTO/EN_NEGOCIACION (no reusa SUSCRIPCION_ACTIVA/PERDIDA)', async () => {
      opportunityRepo.findOne.mockResolvedValue(null);

      await service.startSession(validDto());

      const whereArg = opportunityRepo.findOne.mock.calls[0][0].where;
      expect(whereArg.phone).toBe('8095210288');
      expect(whereArg.subscriptionStatus.code.value).toEqual(
        expect.arrayContaining([SUBSCRIPTION_STATUS_CODE.PROSPECTO, SUBSCRIPTION_STATUS_CODE.EN_NEGOCIACION]),
      );
    });

    it('con el honeypot ("website") lleno, no crea ninguna oportunidad y devuelve un sessionId inerte', async () => {
      const result = await service.startSession(validDto({ website: 'http://spam-bot.example' }));

      expect(opportunityRepo.findOne).not.toHaveBeenCalled();
      expect(opportunityRepo.create).not.toHaveBeenCalled();
      expect(opportunityRepo.save).not.toHaveBeenCalled();
      expect(result.isReturning).toBe(false);
      expect(result.sessionId).toMatch(UUID_REGEX);
    });
  });

  describe('sendMessage', () => {
    it('lanza NotFoundException si el sessionId no corresponde a ninguna oportunidad', async () => {
      opportunityRepo.findOne.mockResolvedValue(null);

      await expect(service.sendMessage('id-inexistente', 'hola')).rejects.toThrow(NotFoundException);
    });

    it('llama a AiChatbotClientService con (sessionId, message, opportunity.name) y devuelve la respuesta de la IA', async () => {
      opportunityRepo.findOne.mockResolvedValue({ id: 'opportunity-1', name: 'Carlos', notes: '', subscriptionStatus: PROSPECTO });
      aiChatbotClient.sendMessage.mockResolvedValue({
        conversationId: 'conv-1',
        response: 'Hola, ¿en qué te ayudo?',
        intent: 'saludo',
        status: 'ACTIVE',
        escalated: false,
      });

      const result = await service.sendMessage('opportunity-1', 'hola');

      expect(aiChatbotClient.sendMessage).toHaveBeenCalledWith('opportunity-1', 'hola', 'Carlos');
      expect(result.message).toBe('Hola, ¿en qué te ayudo?');
      expect(opportunityRepo.save).toHaveBeenCalled();
    });

    it('si Chatbot_sumtech falla (timeout/caído), no propaga el error y devuelve un mensaje de fallback', async () => {
      opportunityRepo.findOne.mockResolvedValue({ id: 'opportunity-1', name: 'Carlos', notes: '', subscriptionStatus: PROSPECTO });
      aiChatbotClient.sendMessage.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.sendMessage('opportunity-1', 'hola');

      expect(result.message).toContain('asesor de Sumtech te contactará');
      expect(opportunityRepo.save).not.toHaveBeenCalled();
    });

    it('sube la oportunidad de PROSPECTO a EN_NEGOCIACION cuando el intent es calificante', async () => {
      const opportunity = { id: 'opportunity-1', name: 'Carlos', notes: '', subscriptionStatus: PROSPECTO, subscriptionStatusId: PROSPECTO.id };
      opportunityRepo.findOne.mockResolvedValue(opportunity);
      aiChatbotClient.sendMessage.mockResolvedValue({
        conversationId: 'conv-1',
        response: 'Tenemos 3 planes...',
        intent: 'consulta_planes_internet',
        status: 'ACTIVE',
        escalated: false,
      });

      await service.sendMessage('opportunity-1', '¿qué planes tienen?');

      expect(opportunityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionStatusId: EN_NEGOCIACION.id }),
      );
    });

    it('no cambia el estado si la oportunidad ya está EN_NEGOCIACION y llega otro intent calificante', async () => {
      const opportunity = { id: 'opportunity-1', name: 'Carlos', notes: '', subscriptionStatus: EN_NEGOCIACION, subscriptionStatusId: EN_NEGOCIACION.id };
      opportunityRepo.findOne.mockResolvedValue(opportunity);
      aiChatbotClient.sendMessage.mockResolvedValue({
        conversationId: 'conv-1',
        response: 'Claro, seguimos...',
        intent: 'consulta_planes_internet',
        status: 'ACTIVE',
        escalated: false,
      });

      await service.sendMessage('opportunity-1', 'otra pregunta');

      expect(opportunityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionStatusId: EN_NEGOCIACION.id }),
      );
    });

    it('sube a EN_NEGOCIACION cuando escalated=true aunque el intent no esté en la whitelist', async () => {
      const opportunity = { id: 'opportunity-1', name: 'Carlos', notes: '', subscriptionStatus: PROSPECTO, subscriptionStatusId: PROSPECTO.id };
      opportunityRepo.findOne.mockResolvedValue(opportunity);
      aiChatbotClient.sendMessage.mockResolvedValue({
        conversationId: 'conv-1',
        response: 'Te transfiero con un asesor.',
        intent: 'desconocido',
        status: 'WAITING_HUMAN',
        escalated: true,
      });

      await service.sendMessage('opportunity-1', 'quiero hablar con alguien');

      expect(opportunityRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionStatusId: EN_NEGOCIACION.id }),
      );
    });

    it('trunca notes a un máximo de 4000 caracteres conservando el contenido más reciente', async () => {
      const opportunity = { id: 'opportunity-1', name: 'Carlos', notes: 'x'.repeat(3990), subscriptionStatus: PROSPECTO, subscriptionStatusId: PROSPECTO.id };
      opportunityRepo.findOne.mockResolvedValue(opportunity);
      aiChatbotClient.sendMessage.mockResolvedValue({
        conversationId: 'conv-1',
        response: 'y'.repeat(300),
        intent: 'saludo',
        status: 'ACTIVE',
        escalated: false,
      });

      await service.sendMessage('opportunity-1', 'z'.repeat(300));

      const savedOpportunity = opportunityRepo.save.mock.calls[0][0];
      expect(savedOpportunity.notes.length).toBeLessThanOrEqual(4000);
      expect(savedOpportunity.notes.endsWith('"')).toBe(true); // conserva el final (lo más reciente), no el inicio
    });
  });
});
