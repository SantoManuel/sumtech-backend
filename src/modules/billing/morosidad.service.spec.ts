import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MorosidadService } from './morosidad.service';
import { BillingSettingsService } from './billing-settings.service';
import { ContractEntity } from '../clients/entities/contract.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { SystemEvents } from '../../common/enums/system-events.enum';

describe('MorosidadService', () => {
  let service: MorosidadService;
  let contractRepo: any;
  let invoiceRepo: any;
  let billingSettingsService: any;
  let eventEmitter: any;

  const DEFAULT_SETTINGS = {
    graceDaysBeforeSuspension: 5,
    reminderDaysAfterDue: 2,
    advanceReminderDaysBeforeDue: 3,
  };

  const makeInvoice = (overrides: Partial<InvoiceEntity> = {}): InvoiceEntity =>
    ({
      id: 'inv-1',
      clientId: 'client-1',
      contractId: 'contract-1',
      status: 'PENDING_PAYMENT',
      concept: 'Fibra 100 Mbps - Servicio de septiembre de 2026',
      grandTotal: 2400,
      dueDate: '2026-09-15',
      advanceReminderSentAt: undefined,
      overdueReminderSentAt: undefined,
      contract: { id: 'contract-1', contractNumber: 'CTR-0001', status: 'ACTIVE' } as ContractEntity,
      ...overrides,
    }) as InvoiceEntity;

  beforeEach(async () => {
    contractRepo = {
      findOneBy: jest.fn(),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };
    invoiceRepo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };
    billingSettingsService = {
      getSettings: jest.fn().mockResolvedValue(DEFAULT_SETTINGS),
    };
    eventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MorosidadService,
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: getRepositoryToken(InvoiceEntity), useValue: invoiceRepo },
        { provide: BillingSettingsService, useValue: billingSettingsService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<MorosidadService>(MorosidadService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('runMorosidadCycle', () => {
    it('envía un recordatorio preventivo cuando faltan menos días de los configurados para el vencimiento', async () => {
      // dueDate 2026-09-15, referencia 2026-09-13 => faltan 2 días (<= 3 configurados)
      invoiceRepo.find.mockResolvedValue([makeInvoice({ dueDate: '2026-09-15' })]);

      const result = await service.runMorosidadCycle(new Date(2026, 8, 13));

      expect(result.advanceRemindersSent).toBe(1);
      expect(result.overdueRemindersSent).toBe(0);
      expect(result.contractsSuspended).toBe(0);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        SystemEvents.PAYMENT_REMINDER_DUE,
        expect.objectContaining({ kind: 'ADVANCE', invoiceId: 'inv-1' }),
      );
      expect(invoiceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ advanceReminderSentAt: expect.any(Date) }),
      );
    });

    it('no reenvía el recordatorio preventivo si ya fue enviado antes', async () => {
      invoiceRepo.find.mockResolvedValue([
        makeInvoice({ dueDate: '2026-09-15', advanceReminderSentAt: new Date('2026-09-12') }),
      ]);

      const result = await service.runMorosidadCycle(new Date(2026, 8, 13));

      expect(result.advanceRemindersSent).toBe(0);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('envía un recordatorio de vencimiento cuando la factura está vencida más allá del umbral configurado', async () => {
      // dueDate 2026-09-15, referencia 2026-09-18 => 3 días vencida (>= 2 configurados), aún < 5 (gracia)
      invoiceRepo.find.mockResolvedValue([makeInvoice({ dueDate: '2026-09-15' })]);

      const result = await service.runMorosidadCycle(new Date(2026, 8, 18));

      expect(result.overdueRemindersSent).toBe(1);
      expect(result.contractsSuspended).toBe(0);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        SystemEvents.PAYMENT_REMINDER_DUE,
        expect.objectContaining({ kind: 'OVERDUE', daysOverdue: 3 }),
      );
    });

    it('no envía el recordatorio de vencimiento antes de que se cumpla reminderDaysAfterDue', async () => {
      // dueDate 2026-09-15, referencia 2026-09-16 => 1 día vencida (< 2 configurados)
      invoiceRepo.find.mockResolvedValue([makeInvoice({ dueDate: '2026-09-15' })]);

      const result = await service.runMorosidadCycle(new Date(2026, 8, 16));

      expect(result.overdueRemindersSent).toBe(0);
      expect(result.contractsSuspended).toBe(0);
    });

    it('suspende el contrato cuando la mora supera el período de gracia configurado', async () => {
      // dueDate 2026-09-15, referencia 2026-09-21 => 6 días vencida (>= 5 de gracia)
      invoiceRepo.find.mockResolvedValue([makeInvoice({ dueDate: '2026-09-15' })]);

      const result = await service.runMorosidadCycle(new Date(2026, 8, 21));

      expect(result.contractsSuspended).toBe(1);
      expect(contractRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUSPENDED' }));
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        SystemEvents.CONTRACT_SUSPENDED,
        expect.objectContaining({ contractId: 'contract-1', contractNumber: 'CTR-0001', daysOverdue: 6 }),
      );
    });

    it('no suspende un contrato que ya está SUSPENDED (evita re-emitir el evento)', async () => {
      invoiceRepo.find.mockResolvedValue([
        makeInvoice({
          dueDate: '2026-09-15',
          contract: { id: 'contract-1', contractNumber: 'CTR-0001', status: 'SUSPENDED' } as ContractEntity,
        }),
      ]);

      const result = await service.runMorosidadCycle(new Date(2026, 8, 21));

      expect(result.contractsSuspended).toBe(0);
      expect(contractRepo.save).not.toHaveBeenCalled();
    });

    it('con varias facturas vencidas del mismo contrato, lo suspende una sola vez', async () => {
      invoiceRepo.find.mockResolvedValue([
        makeInvoice({ id: 'inv-1', dueDate: '2026-09-01' }),
        makeInvoice({ id: 'inv-2', dueDate: '2026-08-01' }),
      ]);

      const result = await service.runMorosidadCycle(new Date(2026, 8, 21));

      expect(result.contractsSuspended).toBe(1);
      expect(contractRepo.save).toHaveBeenCalledTimes(1);
    });

    it('un error en una factura no aborta el procesamiento de las demás', async () => {
      const invoiceA = makeInvoice({ id: 'inv-a', contractId: 'contract-a', dueDate: '2026-09-15' });
      const invoiceB = makeInvoice({ id: 'inv-b', contractId: 'contract-b', dueDate: '2026-09-15' });
      invoiceRepo.find.mockResolvedValue([invoiceA, invoiceB]);
      invoiceRepo.save
        .mockImplementationOnce(() => {
          throw new Error('fallo inesperado guardando el recordatorio de inv-a');
        })
        .mockImplementationOnce((entity: any) => Promise.resolve(entity));

      const result = await service.runMorosidadCycle(new Date(2026, 8, 13));

      expect(result.failed).toBe(1);
      expect(result.advanceRemindersSent).toBe(1);
    });

    it('salta silenciosamente una factura sin due_date sin contarla como fallo', async () => {
      invoiceRepo.find.mockResolvedValue([makeInvoice({ dueDate: undefined as any })]);

      const result = await service.runMorosidadCycle(new Date(2026, 8, 13));

      expect(result).toEqual({
        advanceRemindersSent: 0,
        overdueRemindersSent: 0,
        contractsSuspended: 0,
        failed: 0,
      });
    });

    it('no hace nada si no hay facturas PENDING_PAYMENT', async () => {
      invoiceRepo.find.mockResolvedValue([]);

      const result = await service.runMorosidadCycle(new Date(2026, 8, 21));

      expect(result).toEqual({
        advanceRemindersSent: 0,
        overdueRemindersSent: 0,
        contractsSuspended: 0,
        failed: 0,
      });
    });
  });

  describe('reactivateIfSettled', () => {
    it('devuelve false si el contrato no existe', async () => {
      contractRepo.findOneBy.mockResolvedValue(null);

      const result = await service.reactivateIfSettled('contract-1');

      expect(result).toBe(false);
    });

    it('devuelve false si el contrato no está SUSPENDED', async () => {
      contractRepo.findOneBy.mockResolvedValue({ id: 'contract-1', status: 'ACTIVE' });

      const result = await service.reactivateIfSettled('contract-1');

      expect(result).toBe(false);
      expect(contractRepo.save).not.toHaveBeenCalled();
    });

    it('devuelve false y no reactiva si aún hay facturas vencidas pendientes', async () => {
      contractRepo.findOneBy.mockResolvedValue({ id: 'contract-1', status: 'SUSPENDED', clientId: 'client-1' });
      invoiceRepo.count.mockResolvedValue(1);

      const result = await service.reactivateIfSettled('contract-1');

      expect(result).toBe(false);
      expect(contractRepo.save).not.toHaveBeenCalled();
    });

    it('reactiva el contrato y emite CONTRACT_REACTIVATED cuando ya no hay facturas vencidas', async () => {
      contractRepo.findOneBy.mockResolvedValue({
        id: 'contract-1',
        contractNumber: 'CTR-0001',
        status: 'SUSPENDED',
        clientId: 'client-1',
      });
      invoiceRepo.count.mockResolvedValue(0);

      const result = await service.reactivateIfSettled('contract-1');

      expect(result).toBe(true);
      expect(contractRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE' }));
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        SystemEvents.CONTRACT_REACTIVATED,
        expect.objectContaining({ contractId: 'contract-1', clientId: 'client-1' }),
      );
    });
  });

  describe('getCarteraVencida', () => {
    it('resume el total adeudado y los clientes afectados a partir de las facturas vencidas', async () => {
      invoiceRepo.find.mockResolvedValue([
        makeInvoice({
          id: 'inv-1',
          clientId: 'client-1',
          dueDate: '2026-09-01',
          grandTotal: 1000,
          client: { name: 'Cliente A', docNumber: '001-0000001-1' } as any,
          contract: { contractNumber: 'CTR-0001', status: 'SUSPENDED', plan: { name: 'Fibra 100' } } as any,
        }),
        makeInvoice({
          id: 'inv-2',
          clientId: 'client-2',
          dueDate: '2026-09-05',
          grandTotal: 500,
          client: { name: 'Cliente B', docNumber: '001-0000002-2' } as any,
          contract: { contractNumber: 'CTR-0002', status: 'ACTIVE', plan: { name: 'Fibra 50' } } as any,
        }),
      ]);

      const report = await service.getCarteraVencida(new Date(2026, 8, 21));

      expect(report.summary.totalOverdueInvoices).toBe(2);
      expect(report.summary.totalOverdueAmount).toBe(1500);
      expect(report.summary.clientsAffected).toBe(2);
      expect(report.items[0]).toEqual(
        expect.objectContaining({ clientName: 'Cliente A', contractNumber: 'CTR-0001', daysOverdue: 20 }),
      );
    });
  });
});
