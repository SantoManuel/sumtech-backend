import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SuspensionHistoryService } from './suspension-history.service';
import { SuspensionHistoryEntity } from './entities/suspension-history.entity';

describe('SuspensionHistoryService', () => {
  let service: SuspensionHistoryService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((entity) => Promise.resolve({ id: entity.id || 'susp-generated', ...entity })),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SuspensionHistoryService, { provide: getRepositoryToken(SuspensionHistoryEntity), useValue: repo }],
    }).compile();

    service = module.get<SuspensionHistoryService>(SuspensionHistoryService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('openSuspension', () => {
    it('crea un nuevo registro con los datos provistos y suspendedAt = ahora', async () => {
      const result = await service.openSuspension({
        contractId: 'contract-1',
        clientId: 'client-1',
        reason: 'Suspensión automática por morosidad: 6 día(s) de atraso.',
        relatedInvoiceId: 'inv-1',
        triggeredByProcess: 'CRON_MOROSIDAD',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          clientId: 'client-1',
          reason: expect.stringContaining('morosidad'),
          relatedInvoiceId: 'inv-1',
          triggeredByProcess: 'CRON_MOROSIDAD',
          suspendedAt: expect.any(Date),
        }),
      );
      expect(result.id).toBeDefined();
    });

    it('acepta triggeredByUserId + observation para suspensión manual', async () => {
      await service.openSuspension({
        contractId: 'contract-1',
        clientId: 'client-1',
        reason: 'Suspensión manual por administrador.',
        triggeredByUserId: 'user-admin-1',
        triggeredByProcess: 'MANUAL',
        observation: 'Cliente solicitó pausa temporal.',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          triggeredByUserId: 'user-admin-1',
          triggeredByProcess: 'MANUAL',
          observation: 'Cliente solicitó pausa temporal.',
        }),
      );
    });
  });

  describe('closeSuspension', () => {
    it('cierra la suspensión abierta más reciente (reconnectedAt IS NULL) del contrato', async () => {
      const openEntry = { id: 'susp-1', contractId: 'contract-1', reconnectedAt: null };
      repo.findOne.mockResolvedValue(openEntry);

      const result = await service.closeSuspension('contract-1', {
        reconnectedByUserId: 'user-cajero-1',
        reconnectionFeeInvoiceId: 'inv-fee-1',
      });

      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { contractId: 'contract-1', reconnectedAt: expect.anything() } }),
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'susp-1',
          reconnectedAt: expect.any(Date),
          reconnectedByUserId: 'user-cajero-1',
          reconnectionFeeInvoiceId: 'inv-fee-1',
        }),
      );
      expect(result).not.toBeNull();
    });

    it('cierra sin cargo de reconexión cuando no se provee (reactivación normal sin fee)', async () => {
      repo.findOne.mockResolvedValue({ id: 'susp-1', contractId: 'contract-1', reconnectedAt: null });

      await service.closeSuspension('contract-1');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ reconnectedByUserId: undefined, reconnectionFeeInvoiceId: undefined }),
      );
    });

    it('no-op defensivo: devuelve null y no llama a save si no hay ninguna suspensión abierta', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.closeSuspension('contract-sin-suspension');

      expect(result).toBeNull();
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('findHistoryForClient', () => {
    it('devuelve el historial ordenado por fecha de suspensión descendente, con relaciones cargadas', async () => {
      repo.find.mockResolvedValue([{ id: 'susp-1' }, { id: 'susp-2' }]);

      const result = await service.findHistoryForClient('client-1');

      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clientId: 'client-1' },
          order: { suspendedAt: 'DESC' },
          relations: expect.arrayContaining(['relatedInvoice', 'triggeredByUser', 'reconnectedByUser', 'reconnectionFeeInvoice']),
        }),
      );
      expect(result).toHaveLength(2);
    });
  });
});
