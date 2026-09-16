import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrmService } from './crm.service';
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
import { ClientsService } from '../clients/clients.service';
import { AiChatbotClientService } from '../ai-chatbot/ai-chatbot-client.service';

describe('CrmService', () => {
  let service: CrmService;
  let opportunityRepo: any;
  let interactionRepo: any;
  let subscriptionStatusRepo: any;
  let nextActionRepo: any;
  let lossReasonRepo: any;
  let userRepo: any;
  let cursorRepo: any;
  let clientsService: any;
  let aiChatbotClient: any;
  let userQueryBuilder: any;
  let stateHistoryRepo: any;
  let slaPolicyRepo: any;
  let surveyRepo: any;

  const PROSPECTO = { id: 'status-prospecto', code: SUBSCRIPTION_STATUS_CODE.PROSPECTO, name: 'Prospecto' };
  const EN_NEGOCIACION = { id: 'status-en-negociacion', code: SUBSCRIPTION_STATUS_CODE.EN_NEGOCIACION, name: 'En Negociación' };
  const SUSCRIPCION_ACTIVA = { id: 'status-activa', code: SUBSCRIPTION_STATUS_CODE.SUSCRIPCION_ACTIVA, name: 'Suscripción Activa' };
  const PERDIDA = { id: 'status-perdida', code: SUBSCRIPTION_STATUS_CODE.PERDIDA, name: 'Pérdida' };
  const ALL_STATUSES = [PROSPECTO, EN_NEGOCIACION, SUSCRIPCION_ACTIVA, PERDIDA];

  const LLAMAR_PRESENTACION = { id: 'action-llamar', code: NEXT_ACTION_CODE.LLAMAR_PRESENTACION, name: 'Llamar para presentación' };
  const ENVIAR_ENCUESTA = { id: 'action-encuesta', code: NEXT_ACTION_CODE.ENVIAR_ENCUESTA, name: 'Enviar encuesta de satisfacción' };

  const baseOpportunity = (overrides: Record<string, any> = {}): any => ({
    id: 'opp-1',
    name: 'Juan Pérez',
    phone: '8095551234',
    email: 'juan@test.com',
    planId: 'plan-1',
    subscriptionStatusId: PROSPECTO.id,
    subscriptionStatus: PROSPECTO,
    ...overrides,
  });

  beforeEach(async () => {
    opportunityRepo = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto: any) => ({ ...dto })),
      save: jest.fn((entity: any) => Promise.resolve({ id: entity.id ?? 'opp-generated', ...entity })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    interactionRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'interaction-1', ...entity })),
    };
    subscriptionStatusRepo = {
      findOneBy: jest.fn(({ code, id }: any) => {
        if (code) return Promise.resolve(ALL_STATUSES.find((s) => s.code === code) ?? null);
        if (id) return Promise.resolve(ALL_STATUSES.find((s) => s.id === id) ?? null);
        return Promise.resolve(null);
      }),
    };
    nextActionRepo = {
      findOneBy: jest.fn(({ code }: any) => {
        if (code === NEXT_ACTION_CODE.LLAMAR_PRESENTACION) return Promise.resolve(LLAMAR_PRESENTACION);
        if (code === NEXT_ACTION_CODE.ENVIAR_ENCUESTA) return Promise.resolve(ENVIAR_ENCUESTA);
        return Promise.resolve(null);
      }),
    };
    lossReasonRepo = {
      findOneBy: jest.fn(),
    };
    userQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    userRepo = {
      createQueryBuilder: jest.fn(() => userQueryBuilder),
    };
    cursorRepo = {
      findOneBy: jest.fn().mockResolvedValue({ id: 1, lastAssignedUserId: null }),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
    };
    clientsService = {
      create: jest.fn(),
      addContract: jest.fn(),
    };
    aiChatbotClient = {
      getConversationByPhone: jest.fn(),
    };
    stateHistoryRepo = {
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'history-1', ...entity })),
      find: jest.fn().mockResolvedValue([]),
    };
    slaPolicyRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(),
    };
    surveyRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'survey-1', ...entity })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrmService,
        { provide: getRepositoryToken(OpportunityEntity), useValue: opportunityRepo },
        { provide: getRepositoryToken(InteractionEntity), useValue: interactionRepo },
        { provide: getRepositoryToken(SubscriptionStatusEntity), useValue: subscriptionStatusRepo },
        { provide: getRepositoryToken(NextActionEntity), useValue: nextActionRepo },
        { provide: getRepositoryToken(LossReasonEntity), useValue: lossReasonRepo },
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: getRepositoryToken(RoundRobinCursorEntity), useValue: cursorRepo },
        { provide: getRepositoryToken(OpportunityStateHistoryEntity), useValue: stateHistoryRepo },
        { provide: getRepositoryToken(SlaPolicyEntity), useValue: slaPolicyRepo },
        { provide: getRepositoryToken(SatisfactionSurveyEntity), useValue: surveyRepo },
        { provide: ClientsService, useValue: clientsService },
        { provide: AiChatbotClientService, useValue: aiChatbotClient },
      ],
    }).compile();

    service = module.get<CrmService>(CrmService);

    // findById() se usa internamente por casi todos los métodos — por defecto
    // devuelve una oportunidad PROSPECTO válida; los tests que necesiten otra
    // cosa sobreescriben el mock puntualmente.
    opportunityRepo.findOne.mockResolvedValue(baseOpportunity());
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('assignNextAgent (round robin)', () => {
    it('devuelve null si no hay agentes AGENTE_CRM activos', async () => {
      userQueryBuilder.getMany.mockResolvedValue([]);

      const result = await service.assignNextAgent();

      expect(result).toBeNull();
      expect(cursorRepo.save).not.toHaveBeenCalled();
    });

    it('asigna al primer agente cuando el cursor no tiene un último asignado', async () => {
      userQueryBuilder.getMany.mockResolvedValue([{ id: 'user-a' }, { id: 'user-b' }]);
      cursorRepo.findOneBy.mockResolvedValue({ id: 1, lastAssignedUserId: null });

      const result = await service.assignNextAgent();

      expect(result).toBe('user-a');
      expect(cursorRepo.save).toHaveBeenCalledWith(expect.objectContaining({ lastAssignedUserId: 'user-a' }));
    });

    it('rota al siguiente agente después del último asignado', async () => {
      userQueryBuilder.getMany.mockResolvedValue([{ id: 'user-a' }, { id: 'user-b' }, { id: 'user-c' }]);
      cursorRepo.findOneBy.mockResolvedValue({ id: 1, lastAssignedUserId: 'user-a' });

      const result = await service.assignNextAgent();

      expect(result).toBe('user-b');
    });

    it('vuelve al primer agente cuando el último asignado era el último de la lista (rotación circular)', async () => {
      userQueryBuilder.getMany.mockResolvedValue([{ id: 'user-a' }, { id: 'user-b' }]);
      cursorRepo.findOneBy.mockResolvedValue({ id: 1, lastAssignedUserId: 'user-b' });

      const result = await service.assignNextAgent();

      expect(result).toBe('user-a');
    });

    it('si el último agente asignado ya no está activo/existe, reinicia la rotación desde el primero', async () => {
      userQueryBuilder.getMany.mockResolvedValue([{ id: 'user-a' }, { id: 'user-b' }]);
      cursorRepo.findOneBy.mockResolvedValue({ id: 1, lastAssignedUserId: 'user-desactivado' });

      const result = await service.assignNextAgent();

      expect(result).toBe('user-a');
    });

    it('filtra por rol AGENTE_CRM e isActive=true en la consulta', async () => {
      userQueryBuilder.getMany.mockResolvedValue([]);

      await service.assignNextAgent();

      expect(userQueryBuilder.innerJoin).toHaveBeenCalledWith('u.roles', 'r');
      expect(userQueryBuilder.where).toHaveBeenCalledWith('r.name = :role', { role: 'AGENTE_CRM' });
      expect(userQueryBuilder.andWhere).toHaveBeenCalledWith('u.isActive = true');
    });
  });

  describe('create', () => {
    it('crea la oportunidad en PROSPECTO con la próxima acción sugerida y asignación por round robin', async () => {
      userQueryBuilder.getMany.mockResolvedValue([{ id: 'user-a' }]);
      cursorRepo.findOneBy.mockResolvedValue({ id: 1, lastAssignedUserId: null });

      const result = await service.create({ name: 'Nuevo Prospecto', phone: '8095550000' });

      expect(opportunityRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionStatusId: PROSPECTO.id,
          nextActionId: LLAMAR_PRESENTACION.id,
          assignedUserId: 'user-a',
          potentialValue: 0,
          source: 'WEB_LANDING',
        }),
      );
      expect(result).toBeDefined();
    });

    it('deja assignedUserId sin definir si no hay agentes activos (no bloquea la creación)', async () => {
      userQueryBuilder.getMany.mockResolvedValue([]);

      await service.create({ name: 'Nuevo Prospecto', phone: '8095550000' });

      const createCall = opportunityRepo.create.mock.calls[0][0];
      expect(createCall.assignedUserId).toBeUndefined();
    });

    it('respeta potentialValue explícito en vez de forzar 0', async () => {
      userQueryBuilder.getMany.mockResolvedValue([]);

      await service.create({ name: 'Prospecto Grande', phone: '8095550000', potentialValue: 5000 });

      expect(opportunityRepo.create).toHaveBeenCalledWith(expect.objectContaining({ potentialValue: 5000 }));
    });
  });

  describe('updateStatus', () => {
    it('rechaza con BadRequestException el intento de pasar directo a SUSCRIPCION_ACTIVA', async () => {
      subscriptionStatusRepo.findOneBy.mockImplementation(({ id }: any) =>
        Promise.resolve(ALL_STATUSES.find((s) => s.id === id) ?? null),
      );

      await expect(
        service.updateStatus('opp-1', { subscriptionStatusId: SUSCRIPCION_ACTIVA.id }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza con BadRequestException pasar a PERDIDA sin lossReasonId', async () => {
      await expect(service.updateStatus('opp-1', { subscriptionStatusId: PERDIDA.id })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza con NotFoundException si el lossReasonId no existe', async () => {
      lossReasonRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateStatus('opp-1', { subscriptionStatusId: PERDIDA.id, lossReasonId: 'reason-inexistente' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('marca PERDIDA correctamente: guarda el motivo y limpia la próxima acción', async () => {
      lossReasonRepo.findOneBy.mockResolvedValue({ id: 'reason-1', name: 'Precio' });
      opportunityRepo.findOne.mockResolvedValue(
        baseOpportunity({ nextActionId: LLAMAR_PRESENTACION.id, nextActionDate: '2026-09-20' }),
      );

      await service.updateStatus('opp-1', { subscriptionStatusId: PERDIDA.id, lossReasonId: 'reason-1' });

      expect(opportunityRepo.update).toHaveBeenCalledWith(
        'opp-1',
        expect.objectContaining({
          subscriptionStatusId: PERDIDA.id,
          lossReasonId: 'reason-1',
          nextActionId: null,
          nextActionDate: null,
        }),
      );
    });

    it('permite una transición normal (PROSPECTO -> EN_NEGOCIACION) sin exigir motivo', async () => {
      await service.updateStatus('opp-1', { subscriptionStatusId: EN_NEGOCIACION.id });

      expect(opportunityRepo.update).toHaveBeenCalledWith(
        'opp-1',
        expect.objectContaining({ subscriptionStatusId: EN_NEGOCIACION.id }),
      );
    });

    it('lanza NotFoundException si el subscriptionStatusId destino no existe', async () => {
      await expect(service.updateStatus('opp-1', { subscriptionStatusId: 'status-inexistente' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('closeOpportunity', () => {
    const closeDto = {
      docType: 'CEDULA' as const,
      docNumber: '001-1234567-8',
      clientType: 'FISICA' as const,
      address: { street: 'Calle 1', sector: 'Centro', municipality: 'Santo Domingo Este', city: 'Santo Domingo' },
    };

    beforeEach(() => {
      clientsService.create.mockResolvedValue({
        id: 'client-1',
        addresses: [{ id: 'address-1' }],
      });
      clientsService.addContract.mockResolvedValue({ id: 'contract-1' });
    });

    it('crea el cliente y el contrato, y pasa la oportunidad a SUSCRIPCION_ACTIVA con la encuesta agendada', async () => {
      const result = await service.closeOpportunity('opp-1', closeDto);

      expect(clientsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ docNumber: '001-1234567-8', name: 'Juan Pérez' }),
      );
      expect(clientsService.addContract).toHaveBeenCalledWith('client-1', 'plan-1', 'address-1', undefined);
      expect(opportunityRepo.update).toHaveBeenCalledWith(
        'opp-1',
        expect.objectContaining({
          clientId: 'client-1',
          subscriptionStatusId: SUSCRIPCION_ACTIVA.id,
          nextActionId: ENVIAR_ENCUESTA.id,
        }),
      );
      expect(result.clientId).toBe('client-1');
      expect(result.contractId).toBe('contract-1');
    });

    it('usa el planId del DTO si se provee, en vez del planId de la oportunidad', async () => {
      await service.closeOpportunity('opp-1', { ...closeDto, planId: 'plan-override' });

      expect(clientsService.addContract).toHaveBeenCalledWith('client-1', 'plan-override', 'address-1', undefined);
    });

    it('rechaza con BadRequestException si no hay planId ni en el DTO ni en la oportunidad', async () => {
      opportunityRepo.findOne.mockResolvedValue(baseOpportunity({ planId: undefined }));

      await expect(service.closeOpportunity('opp-1', closeDto)).rejects.toThrow(BadRequestException);
      expect(clientsService.create).not.toHaveBeenCalled();
    });

    it('rechaza con BadRequestException si la oportunidad ya está en SUSCRIPCION_ACTIVA', async () => {
      opportunityRepo.findOne.mockResolvedValue(baseOpportunity({ subscriptionStatus: SUSCRIPCION_ACTIVA }));

      await expect(service.closeOpportunity('opp-1', closeDto)).rejects.toThrow(BadRequestException);
      expect(clientsService.create).not.toHaveBeenCalled();
    });

    it('rechaza con BadRequestException si la oportunidad está en PERDIDA', async () => {
      opportunityRepo.findOne.mockResolvedValue(baseOpportunity({ subscriptionStatus: PERDIDA }));

      await expect(service.closeOpportunity('opp-1', closeDto)).rejects.toThrow(BadRequestException);
      expect(clientsService.create).not.toHaveBeenCalled();
    });

    it('propaga el error si ClientsService.create falla (no marca la oportunidad como cerrada)', async () => {
      clientsService.create.mockRejectedValue(new Error('DGII caído'));

      await expect(service.closeOpportunity('opp-1', closeDto)).rejects.toThrow('DGII caído');
      expect(opportunityRepo.update).not.toHaveBeenCalled();
    });

    it('propaga el error si ClientsService.addContract falla después de crear el cliente (estado recuperable, no silencioso)', async () => {
      clientsService.addContract.mockRejectedValue(new Error('Plan inactivo'));

      await expect(service.closeOpportunity('opp-1', closeDto)).rejects.toThrow('Plan inactivo');
      expect(opportunityRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('historial de estados', () => {
    it('create() registra una fila de historial con previousStatusId=null (nace en PROSPECTO)', async () => {
      userQueryBuilder.getMany.mockResolvedValue([]);

      await service.create({ name: 'Nuevo', phone: '8095550000' }, 'user-creador');

      expect(stateHistoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ previousStatusId: undefined, newStatusId: PROSPECTO.id, changedByUserId: 'user-creador' }),
      );
    });

    it('updateStatus() registra previousStatusId (el estado antes del cambio) y newStatusId', async () => {
      opportunityRepo.findOne.mockResolvedValue(baseOpportunity({ subscriptionStatusId: PROSPECTO.id, subscriptionStatus: PROSPECTO }));

      await service.updateStatus('opp-1', { subscriptionStatusId: EN_NEGOCIACION.id }, 'user-agente');

      expect(stateHistoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          opportunityId: 'opp-1',
          previousStatusId: PROSPECTO.id,
          newStatusId: EN_NEGOCIACION.id,
          changedByUserId: 'user-agente',
        }),
      );
    });

    it('closeOpportunity() registra el historial hacia SUSCRIPCION_ACTIVA con el usuario que cerró', async () => {
      clientsService.create.mockResolvedValue({ id: 'client-1', addresses: [{ id: 'address-1' }] });
      clientsService.addContract.mockResolvedValue({ id: 'contract-1' });
      opportunityRepo.findOne.mockResolvedValue(baseOpportunity({ subscriptionStatusId: EN_NEGOCIACION.id, subscriptionStatus: EN_NEGOCIACION }));

      await service.closeOpportunity(
        'opp-1',
        {
          docType: 'CEDULA',
          docNumber: '001-1234567-8',
          clientType: 'FISICA',
          address: { street: 'Calle 1', sector: 'Centro', municipality: 'SDE', city: 'Santo Domingo' },
        } as any,
        'user-cerrador',
      );

      expect(stateHistoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          previousStatusId: EN_NEGOCIACION.id,
          newStatusId: SUSCRIPCION_ACTIVA.id,
          changedByUserId: 'user-cerrador',
        }),
      );
    });

    it('getStateHistory() devuelve el historial ordenado por fecha descendente', async () => {
      const rows = [{ id: 'h2' }, { id: 'h1' }];
      stateHistoryRepo.find.mockResolvedValue(rows);

      const result = await service.getStateHistory('opp-1');

      expect(stateHistoryRepo.find).toHaveBeenCalledWith({
        where: { opportunityId: 'opp-1' },
        relations: ['previousStatus', 'newStatus', 'changedByUser'],
        order: { changedAt: 'DESC' },
      });
      expect(result).toBe(rows);
    });

    it('getStateHistory() lanza NotFoundException si la oportunidad no existe', async () => {
      opportunityRepo.findOne.mockResolvedValue(null);

      await expect(service.getStateHistory('opp-inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createInteraction', () => {
    it('rechaza con BadRequestException si no se envía clientId ni opportunityId', async () => {
      await expect(
        service.createInteraction('user-1', { channel: 'PHONE_CALL', subject: 'Asunto', notes: 'Notas' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('acepta solo opportunityId (actividad sobre un prospecto sin cliente todavía)', async () => {
      const result = await service.createInteraction('user-1', {
        opportunityId: 'opp-1',
        channel: 'PHONE_CALL',
        subject: 'Llamada de seguimiento',
        notes: 'El prospecto pidió una semana más para decidir.',
      } as any);

      expect(interactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ opportunityId: 'opp-1', clientId: undefined, userId: 'user-1' }),
      );
      expect(result).toBeDefined();
    });

    it('acepta solo clientId (comportamiento histórico, sin cambios)', async () => {
      await service.createInteraction('user-1', {
        clientId: 'client-1',
        channel: 'EMAIL',
        subject: 'Envío de factura',
        notes: 'Factura enviada por correo.',
      } as any);

      expect(interactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'client-1', opportunityId: undefined }),
      );
    });

    it('valida que la oportunidad exista cuando se envía opportunityId', async () => {
      opportunityRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createInteraction('user-1', {
          opportunityId: 'opp-inexistente',
          channel: 'PHONE_CALL',
          subject: 'x',
          notes: 'y',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('aplica paginación por defecto (page=1, limit=15)', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      opportunityRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll({});

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 15, totalPages: 0 });
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(15);
    });

    it('aplica overdueOnly filtrando por nextActionDate < CURRENT_DATE', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      opportunityRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ overdueOnly: true });

      expect(qb.andWhere).toHaveBeenCalledWith('o.nextActionDate IS NOT NULL');
      expect(qb.andWhere).toHaveBeenCalledWith('o.nextActionDate < CURRENT_DATE');
    });
  });

  describe('getDashboardMetrics', () => {
    const buildQb = () => ({
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
      getRawOne: jest.fn(),
      getCount: jest.fn(),
    });

    it('calcula pipeline por estado, cierre del mes, tasa de conversión, pérdidas, actividades y ticket promedio', async () => {
      const opportunityQb = buildQb();
      opportunityQb.getRawMany
        .mockResolvedValueOnce([
          { statusId: PROSPECTO.id, statusCode: 'PROSPECTO', statusName: 'Prospecto', count: '3', totalValue: '15000.00' },
        ])
        .mockResolvedValueOnce([{ reasonName: 'Precio', count: '2' }]);
      opportunityQb.getRawOne.mockResolvedValueOnce({ avg: '1850.50' });
      opportunityRepo.createQueryBuilder.mockReturnValue(opportunityQb);

      const historyQb = buildQb();
      historyQb.getCount.mockResolvedValueOnce(4);
      historyQb.getRawOne
        .mockResolvedValueOnce({ count: '8' }) // ganadas (SUSCRIPCION_ACTIVA)
        .mockResolvedValueOnce({ count: '2' }); // perdidas (PERDIDA)
      stateHistoryRepo.createQueryBuilder = jest.fn().mockReturnValue(historyQb);

      const interactionQb = buildQb();
      interactionQb.getRawMany.mockResolvedValueOnce([{ username: 'luis.crm', count: '12' }]);
      interactionRepo.createQueryBuilder = jest.fn().mockReturnValue(interactionQb);

      const result = await service.getDashboardMetrics();

      expect(result.pipelineByStatus).toEqual([
        { statusId: PROSPECTO.id, statusCode: 'PROSPECTO', statusName: 'Prospecto', count: 3, totalValue: 15000 },
      ]);
      expect(result.closedThisMonth).toBe(4);
      expect(result.wonCount).toBe(8);
      expect(result.lostCount).toBe(2);
      expect(result.conversionRate).toBe(80); // 8 / (8+2) * 100
      expect(result.lossesByReason).toEqual([{ reasonName: 'Precio', count: 2 }]);
      expect(result.activitiesByUser).toEqual([{ username: 'luis.crm', count: 12 }]);
      expect(result.averageTicket).toBe(1850.5);
    });

    it('conversionRate es 0 cuando no hay ninguna oportunidad ganada ni perdida todavía (evita división por cero)', async () => {
      const opportunityQb = buildQb();
      opportunityQb.getRawMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      opportunityQb.getRawOne.mockResolvedValueOnce({ avg: null });
      opportunityRepo.createQueryBuilder.mockReturnValue(opportunityQb);

      const historyQb = buildQb();
      historyQb.getCount.mockResolvedValueOnce(0);
      historyQb.getRawOne.mockResolvedValueOnce({ count: '0' }).mockResolvedValueOnce({ count: '0' });
      stateHistoryRepo.createQueryBuilder = jest.fn().mockReturnValue(historyQb);

      const interactionQb = buildQb();
      interactionQb.getRawMany.mockResolvedValueOnce([]);
      interactionRepo.createQueryBuilder = jest.fn().mockReturnValue(interactionQb);

      const result = await service.getDashboardMetrics();

      expect(result.conversionRate).toBe(0);
      expect(result.averageTicket).toBe(0);
    });
  });

  describe('findSlaBreaches', () => {
    it('devuelve una entrada por oportunidad incumplida, con los días transcurridos calculados', async () => {
      slaPolicyRepo.find.mockResolvedValue([
        { id: 'policy-1', subscriptionStatusId: PROSPECTO.id, maxDaysWithoutActivity: 3, isActive: true },
      ]);
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const breachedOpportunity = baseOpportunity({ lastUpdatedAt: fiveDaysAgo });
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([breachedOpportunity]),
      };
      opportunityRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findSlaBreaches();

      expect(qb.where).toHaveBeenCalledWith('o.subscriptionStatusId = :statusId', { statusId: PROSPECTO.id });
      expect(qb.andWhere).toHaveBeenCalledWith('EXTRACT(DAY FROM NOW() - o.lastUpdatedAt) > :maxDays', { maxDays: 3 });
      expect(result).toHaveLength(1);
      expect(result[0].maxDays).toBe(3);
      expect(result[0].daysSinceUpdate).toBeGreaterThanOrEqual(4);
    });

    it('devuelve un arreglo vacío si no hay políticas de SLA activas', async () => {
      slaPolicyRepo.find.mockResolvedValue([]);

      const result = await service.findSlaBreaches();

      expect(result).toEqual([]);
      expect(opportunityRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('getSatisfactionSurveys', () => {
    it('calcula el promedio de calificación solo sobre encuestas ya respondidas', async () => {
      surveyRepo.find.mockResolvedValue([
        { id: 's1', status: 'SUBMITTED', rating: 5 },
        { id: 's2', status: 'SUBMITTED', rating: 3 },
      ]);

      const result = await service.getSatisfactionSurveys();

      expect(surveyRepo.find).toHaveBeenCalledWith({
        where: { status: 'SUBMITTED' },
        relations: ['opportunity'],
        order: { submittedAt: 'DESC' },
      });
      expect(result.averageRating).toBe(4);
      expect(result.surveys).toHaveLength(2);
    });

    it('averageRating es 0 cuando no hay ninguna encuesta respondida todavía', async () => {
      surveyRepo.find.mockResolvedValue([]);

      const result = await service.getSatisfactionSurveys();

      expect(result.averageRating).toBe(0);
    });
  });
});
