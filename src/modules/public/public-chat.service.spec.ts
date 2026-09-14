import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PublicChatService } from './public-chat.service';
import { LeadEntity } from '../crm/entities/lead.entity';
import { AiChatbotClientService } from '../ai-chatbot/ai-chatbot-client.service';
import { StartPublicChatDto } from './dto/public-chat.dto';

describe('PublicChatService', () => {
  let service: PublicChatService;
  let leadRepo: any;
  let aiChatbotClient: any;

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  beforeEach(async () => {
    leadRepo = {
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((dto: any) => ({ ...dto })),
      save: jest.fn((entity: any) => Promise.resolve({ id: entity.id ?? 'lead-generated', ...entity })),
    };
    aiChatbotClient = {
      sendMessage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicChatService,
        { provide: getRepositoryToken(LeadEntity), useValue: leadRepo },
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
    it('crea un lead nuevo con source WEB_CHATBOT y status NEW cuando no existe uno activo con ese teléfono', async () => {
      leadRepo.findOne.mockResolvedValue(null);

      const result = await service.startSession(validDto());

      expect(leadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Carlos Mendoza',
          phone: '8095210288',
          source: 'WEB_CHATBOT',
          status: 'NEW',
        }),
      );
      expect(leadRepo.save).toHaveBeenCalled();
      expect(result.isReturning).toBe(false);
      expect(result.sessionId).toBe('lead-generated');
    });

    it('reusa el lead existente (mismo sessionId, isReturning true) cuando ya hay uno activo con el mismo teléfono normalizado', async () => {
      leadRepo.findOne.mockResolvedValue({ id: 'lead-existente', phone: '8095210288', status: 'CONTACTED' });

      const result = await service.startSession(validDto({ phone: '(809) 521-0288' }));

      expect(result).toEqual({ sessionId: 'lead-existente', isReturning: true });
      expect(leadRepo.create).not.toHaveBeenCalled();
      expect(leadRepo.save).not.toHaveBeenCalled();
    });

    it('consulta findOne filtrando solo por status NEW/CONTACTED/QUALIFIED (no reusa CONVERTED/DISCARDED)', async () => {
      leadRepo.findOne.mockResolvedValue(null);

      await service.startSession(validDto());

      const whereArg = leadRepo.findOne.mock.calls[0][0].where;
      expect(whereArg.phone).toBe('8095210288');
      expect(whereArg.status.value).toEqual(
        expect.arrayContaining(['NEW', 'CONTACTED', 'QUALIFIED']),
      );
    });

    it('con el honeypot ("website") lleno, no crea ningún lead y devuelve un sessionId inerte', async () => {
      const result = await service.startSession(validDto({ website: 'http://spam-bot.example' }));

      expect(leadRepo.findOne).not.toHaveBeenCalled();
      expect(leadRepo.create).not.toHaveBeenCalled();
      expect(leadRepo.save).not.toHaveBeenCalled();
      expect(result.isReturning).toBe(false);
      expect(result.sessionId).toMatch(UUID_REGEX);
    });
  });

  describe('sendMessage', () => {
    it('lanza NotFoundException si el sessionId no corresponde a ningún lead', async () => {
      leadRepo.findOneBy.mockResolvedValue(null);

      await expect(service.sendMessage('id-inexistente', 'hola')).rejects.toThrow(NotFoundException);
    });

    it('llama a AiChatbotClientService con (sessionId, message, lead.name) y devuelve la respuesta de la IA', async () => {
      leadRepo.findOneBy.mockResolvedValue({ id: 'lead-1', name: 'Carlos', notes: '', status: 'NEW' });
      aiChatbotClient.sendMessage.mockResolvedValue({
        conversationId: 'conv-1',
        response: 'Hola, ¿en qué te ayudo?',
        intent: 'saludo',
        status: 'ACTIVE',
        escalated: false,
      });

      const result = await service.sendMessage('lead-1', 'hola');

      expect(aiChatbotClient.sendMessage).toHaveBeenCalledWith('lead-1', 'hola', 'Carlos');
      expect(result.message).toBe('Hola, ¿en qué te ayudo?');
      expect(leadRepo.save).toHaveBeenCalled();
    });

    it('si Chatbot_sumtech falla (timeout/caído), no propaga el error y devuelve un mensaje de fallback', async () => {
      leadRepo.findOneBy.mockResolvedValue({ id: 'lead-1', name: 'Carlos', notes: '', status: 'NEW' });
      aiChatbotClient.sendMessage.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.sendMessage('lead-1', 'hola');

      expect(result.message).toContain('asesor de Sumtech te contactará');
      expect(leadRepo.save).not.toHaveBeenCalled();
    });

    it('sube el lead de NEW a CONTACTED cuando el intent es calificante', async () => {
      const lead = { id: 'lead-1', name: 'Carlos', notes: '', status: 'NEW' };
      leadRepo.findOneBy.mockResolvedValue(lead);
      aiChatbotClient.sendMessage.mockResolvedValue({
        conversationId: 'conv-1',
        response: 'Tenemos 3 planes...',
        intent: 'consulta_planes_internet',
        status: 'ACTIVE',
        escalated: false,
      });

      await service.sendMessage('lead-1', '¿qué planes tienen?');

      expect(leadRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'CONTACTED' }));
    });

    it('no cambia el status si el lead ya está CONTACTED y llega otro intent calificante', async () => {
      const lead = { id: 'lead-1', name: 'Carlos', notes: '', status: 'CONTACTED' };
      leadRepo.findOneBy.mockResolvedValue(lead);
      aiChatbotClient.sendMessage.mockResolvedValue({
        conversationId: 'conv-1',
        response: 'Claro, seguimos...',
        intent: 'consulta_planes_internet',
        status: 'ACTIVE',
        escalated: false,
      });

      await service.sendMessage('lead-1', 'otra pregunta');

      expect(leadRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'CONTACTED' }));
    });

    it('sube a CONTACTED cuando escalated=true aunque el intent no esté en la whitelist', async () => {
      const lead = { id: 'lead-1', name: 'Carlos', notes: '', status: 'NEW' };
      leadRepo.findOneBy.mockResolvedValue(lead);
      aiChatbotClient.sendMessage.mockResolvedValue({
        conversationId: 'conv-1',
        response: 'Te transfiero con un asesor.',
        intent: 'desconocido',
        status: 'WAITING_HUMAN',
        escalated: true,
      });

      await service.sendMessage('lead-1', 'quiero hablar con alguien');

      expect(leadRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'CONTACTED' }));
    });

    it('trunca notes a un máximo de 4000 caracteres conservando el contenido más reciente', async () => {
      const lead = { id: 'lead-1', name: 'Carlos', notes: 'x'.repeat(3990), status: 'NEW' };
      leadRepo.findOneBy.mockResolvedValue(lead);
      aiChatbotClient.sendMessage.mockResolvedValue({
        conversationId: 'conv-1',
        response: 'y'.repeat(300),
        intent: 'saludo',
        status: 'ACTIVE',
        escalated: false,
      });

      await service.sendMessage('lead-1', 'z'.repeat(300));

      const savedLead = leadRepo.save.mock.calls[0][0];
      expect(savedLead.notes.length).toBeLessThanOrEqual(4000);
      expect(savedLead.notes.endsWith('"')).toBe(true); // conserva el final (lo más reciente), no el inicio
    });
  });
});
