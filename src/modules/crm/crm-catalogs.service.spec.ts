import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CrmCatalogsService } from './crm-catalogs.service';
import { SubscriptionStatusEntity } from './entities/subscription-status.entity';
import { NextActionEntity } from './entities/next-action.entity';
import { LossReasonEntity } from './entities/loss-reason.entity';
import { SlaPolicyEntity } from './entities/sla-policy.entity';

describe('CrmCatalogsService', () => {
  let service: CrmCatalogsService;
  let subscriptionStatusRepo: any;
  let nextActionRepo: any;
  let lossReasonRepo: any;
  let slaPolicyRepo: any;

  beforeEach(async () => {
    subscriptionStatusRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'status-generated', ...entity })),
    };
    nextActionRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'action-generated', ...entity })),
    };
    lossReasonRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'reason-generated', ...entity })),
    };
    slaPolicyRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'sla-generated', ...entity })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrmCatalogsService,
        { provide: getRepositoryToken(SubscriptionStatusEntity), useValue: subscriptionStatusRepo },
        { provide: getRepositoryToken(NextActionEntity), useValue: nextActionRepo },
        { provide: getRepositoryToken(LossReasonEntity), useValue: lossReasonRepo },
        { provide: getRepositoryToken(SlaPolicyEntity), useValue: slaPolicyRepo },
      ],
    }).compile();

    service = module.get<CrmCatalogsService>(CrmCatalogsService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('subscription statuses', () => {
    it('findAllSubscriptionStatuses filtra por isActive=true por defecto', async () => {
      await service.findAllSubscriptionStatuses();

      expect(subscriptionStatusRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    });

    it('findAllSubscriptionStatuses incluye inactivos cuando se pide explícitamente', async () => {
      await service.findAllSubscriptionStatuses(true);

      expect(subscriptionStatusRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    });

    it('createSubscriptionStatus genera un code en mayúsculas snake_case a partir del nombre, sin acentos', async () => {
      const result = await service.createSubscriptionStatus({ name: 'En Negociación Avanzada' });

      expect(subscriptionStatusRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'EN_NEGOCIACION_AVANZADA', name: 'En Negociación Avanzada', isActive: true }),
      );
      expect(result).toBeDefined();
    });

    it('createSubscriptionStatus agrega un sufijo numérico si el code generado ya existe', async () => {
      subscriptionStatusRepo.findOneBy
        .mockResolvedValueOnce({ id: 'existing', code: 'PROSPECTO' })
        .mockResolvedValueOnce(null);

      await service.createSubscriptionStatus({ name: 'Prospecto' });

      expect(subscriptionStatusRepo.create).toHaveBeenCalledWith(expect.objectContaining({ code: 'PROSPECTO_2' }));
    });

    it('updateSubscriptionStatus lanza NotFoundException si el id no existe', async () => {
      subscriptionStatusRepo.findOneBy.mockResolvedValue(null);

      await expect(service.updateSubscriptionStatus('id-inexistente', { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updateSubscriptionStatus permite desactivar sin tocar el code', async () => {
      subscriptionStatusRepo.findOneBy.mockResolvedValue({ id: 'status-1', code: 'PROSPECTO', name: 'Prospecto', isActive: true });

      const result = await service.updateSubscriptionStatus('status-1', { isActive: false });

      expect(result.isActive).toBe(false);
      expect(result.code).toBe('PROSPECTO');
    });
  });

  describe('next actions', () => {
    it('createNextAction guarda suggestedStatusCodes y genera code con máximo 50 caracteres', async () => {
      const longName = 'Enviar un correo de seguimiento detallado con la propuesta comercial completa';
      await service.createNextAction({ name: longName, suggestedStatusCodes: ['PROSPECTO'] });

      const created = nextActionRepo.create.mock.calls[0][0];
      expect(created.code.length).toBeLessThanOrEqual(50);
      expect(created.suggestedStatusCodes).toEqual(['PROSPECTO']);
    });

    it('createNextAction usa un array vacío si no se envían suggestedStatusCodes', async () => {
      await service.createNextAction({ name: 'Acción sin sugerencia' });

      expect(nextActionRepo.create).toHaveBeenCalledWith(expect.objectContaining({ suggestedStatusCodes: [] }));
    });

    it('updateNextAction lanza NotFoundException si el id no existe', async () => {
      nextActionRepo.findOneBy.mockResolvedValue(null);

      await expect(service.updateNextAction('id-inexistente', { name: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('loss reasons', () => {
    it('createLossReason rechaza con ConflictException si ya existe un motivo con el mismo nombre', async () => {
      lossReasonRepo.findOneBy.mockResolvedValue({ id: 'reason-1', name: 'Precio' });

      await expect(service.createLossReason({ name: 'Precio' })).rejects.toThrow(ConflictException);
    });

    it('createLossReason crea el motivo cuando el nombre es único', async () => {
      lossReasonRepo.findOneBy.mockResolvedValue(null);

      const result = await service.createLossReason({ name: 'Precio' });

      expect(lossReasonRepo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Precio', isActive: true }));
      expect(result).toBeDefined();
    });

    it('updateLossReason lanza NotFoundException si el id no existe', async () => {
      lossReasonRepo.findOneBy.mockResolvedValue(null);

      await expect(service.updateLossReason('id-inexistente', { name: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('updateLossReason rechaza con ConflictException si el nuevo nombre ya pertenece a otro motivo', async () => {
      lossReasonRepo.findOneBy
        .mockResolvedValueOnce({ id: 'reason-1', name: 'Precio' })
        .mockResolvedValueOnce({ id: 'reason-2', name: 'Cobertura no disponible' });

      await expect(service.updateLossReason('reason-1', { name: 'Cobertura no disponible' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('updateLossReason permite guardar el mismo nombre sin disparar el chequeo de duplicado', async () => {
      lossReasonRepo.findOneBy.mockResolvedValueOnce({ id: 'reason-1', name: 'Precio' });

      const result = await service.updateLossReason('reason-1', { name: 'Precio', sortOrder: 3 });

      expect(result.sortOrder).toBe(3);
      expect(lossReasonRepo.findOneBy).toHaveBeenCalledTimes(1);
    });
  });

  describe('SLA comercial', () => {
    it('upsertSlaPolicy lanza NotFoundException si el estado no existe', async () => {
      subscriptionStatusRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.upsertSlaPolicy({ subscriptionStatusId: 'status-inexistente', maxDaysWithoutActivity: 5 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('upsertSlaPolicy crea una política nueva si el estado no tiene una todavía', async () => {
      subscriptionStatusRepo.findOneBy.mockResolvedValue({ id: 'status-1', code: 'PROSPECTO' });
      slaPolicyRepo.findOneBy.mockResolvedValue(null);

      await service.upsertSlaPolicy({ subscriptionStatusId: 'status-1', maxDaysWithoutActivity: 5 });

      expect(slaPolicyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionStatusId: 'status-1', maxDaysWithoutActivity: 5, isActive: true }),
      );
    });

    it('upsertSlaPolicy actualiza la política existente en vez de crear una duplicada', async () => {
      subscriptionStatusRepo.findOneBy.mockResolvedValue({ id: 'status-1', code: 'PROSPECTO' });
      const existingPolicy = { id: 'policy-1', subscriptionStatusId: 'status-1', maxDaysWithoutActivity: 3, isActive: true };
      slaPolicyRepo.findOneBy.mockResolvedValue(existingPolicy);

      const result = await service.upsertSlaPolicy({ subscriptionStatusId: 'status-1', maxDaysWithoutActivity: 10 });

      expect(slaPolicyRepo.create).not.toHaveBeenCalled();
      expect(result.maxDaysWithoutActivity).toBe(10);
      expect(slaPolicyRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'policy-1', maxDaysWithoutActivity: 10 }));
    });

    it('findAllSlaPolicies devuelve las políticas ordenadas por el sortOrder de su estado', async () => {
      await service.findAllSlaPolicies();

      expect(slaPolicyRepo.find).toHaveBeenCalledWith({
        relations: ['subscriptionStatus'],
        order: { subscriptionStatus: { sortOrder: 'ASC' } },
      });
    });
  });
});
