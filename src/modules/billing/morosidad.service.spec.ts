import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MorosidadService } from './morosidad.service';
import { BillingSettingsService } from './billing-settings.service';
import { SuspensionHistoryService } from './suspension-history.service';
import { ContractEntity } from '../clients/entities/contract.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { SystemEvents } from '../../common/enums/system-events.enum';
import { NetworkAccessEntity } from '../network/entities/network-access.entity';
import { ServiceControlService } from '../network/service-control.service';
import { NetworkProvisioningPortRegistry } from '../network/network-provisioning-port.registry';
import { TenantIteratorService } from '../../common/tenancy/tenant-iterator.service';

describe('MorosidadService', () => {
  let service: MorosidadService;
  let contractRepo: any;
  let invoiceRepo: any;
  let accessRepo: any;
  let billingSettingsService: any;
  let suspensionHistoryService: any;
  let serviceControlService: any;
  let portRegistry: any;
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
      contract: { id: 'contract-1', contractNumber: 'CTR-0001', status: 'ACTIVE', clientId: 'client-1' } as ContractEntity,
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
    accessRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    billingSettingsService = {
      getSettings: jest.fn().mockResolvedValue(DEFAULT_SETTINGS),
    };
    suspensionHistoryService = {
      openSuspension: jest.fn().mockResolvedValue({ id: 'susp-1' }),
      closeSuspension: jest.fn().mockResolvedValue({ id: 'susp-1' }),
    };
    serviceControlService = {
      suspendService: jest.fn().mockResolvedValue({ applied: true, medium: 'PPPOE', verified: true }),
      restoreService: jest.fn().mockResolvedValue({ applied: true, medium: 'PPPOE', verified: true }),
    };
    portRegistry = {
      resolveSuspensionMedium: jest.fn().mockReturnValue('PPPOE'),
    };
    eventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MorosidadService,
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: getRepositoryToken(InvoiceEntity), useValue: invoiceRepo },
        { provide: getRepositoryToken(NetworkAccessEntity), useValue: accessRepo },
        { provide: BillingSettingsService, useValue: billingSettingsService },
        { provide: SuspensionHistoryService, useValue: suspensionHistoryService },
        { provide: ServiceControlService, useValue: serviceControlService },
        { provide: NetworkProvisioningPortRegistry, useValue: portRegistry },
        { provide: EventEmitter2, useValue: eventEmitter },
        {
          provide: TenantIteratorService,
          useValue: { runForEachActiveTenant: jest.fn((_label: string, fn: (t: any) => Promise<void>) => fn({ slug: 'tenant-test' })) },
        },
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
        expect.objectContaining({
          contractId: 'contract-1',
          contractNumber: 'CTR-0001',
          daysOverdue: 6,
          reason: 'Suspensión automática por morosidad: 6 día(s) de atraso.',
        }),
      );
      expect(suspensionHistoryService.openSuspension).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          clientId: 'client-1',
          relatedInvoiceId: 'inv-1',
          triggeredByProcess: 'CRON_MOROSIDAD',
          reason: 'Suspensión automática por morosidad: 6 día(s) de atraso.',
        }),
      );
    });

    it('no suspende un contrato que ya está SUSPENDED (evita re-emitir el evento)', async () => {
      invoiceRepo.find.mockResolvedValue([
        makeInvoice({
          dueDate: '2026-09-15',
          contract: { id: 'contract-1', contractNumber: 'CTR-0001', status: 'SUSPENDED', clientId: 'client-1' } as ContractEntity,
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

  describe('máquina de estados EN_GRACIA / VENCIDA', () => {
    it('transiciona PENDING_PAYMENT -> EN_GRACIA el primer día vencido (dentro del período de gracia) y estampa las fechas de gracia', async () => {
      // dueDate 2026-09-15, referencia 2026-09-16 => 1 día vencido, gracia=5 => EN_GRACIA
      invoiceRepo.find.mockResolvedValue([makeInvoice({ dueDate: '2026-09-15', status: 'PENDING_PAYMENT' })]);

      await service.runMorosidadCycle(new Date(2026, 8, 16));

      expect(invoiceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'EN_GRACIA',
          daysOverdue: 1,
          gracePeriodStartedAt: '2026-09-16',
          gracePeriodEndsAt: '2026-09-20',
        }),
      );
    });

    it('transiciona a VENCIDA una vez superado el período de gracia', async () => {
      // dueDate 2026-09-15, referencia 2026-09-21 => 6 días vencido, gracia=5 => VENCIDA
      invoiceRepo.find.mockResolvedValue([makeInvoice({ dueDate: '2026-09-15', status: 'PENDING_PAYMENT' })]);

      await service.runMorosidadCycle(new Date(2026, 8, 21));

      expect(invoiceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'VENCIDA', daysOverdue: 6 }),
      );
    });

    it('NO sobreescribe gracePeriodStartedAt/gracePeriodEndsAt en una segunda corrida (ya venía de EN_GRACIA)', async () => {
      invoiceRepo.find.mockResolvedValue([
        makeInvoice({
          dueDate: '2026-09-15',
          status: 'EN_GRACIA',
          daysOverdue: 3,
          gracePeriodStartedAt: '2026-09-16',
          gracePeriodEndsAt: '2026-09-20',
          overdueReminderSentAt: new Date('2026-09-17'),
        }),
      ]);

      // referencia 2026-09-19 => 4 días vencido, aún < gracia(5) => sigue EN_GRACIA
      await service.runMorosidadCycle(new Date(2026, 8, 19));

      expect(invoiceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'EN_GRACIA',
          daysOverdue: 4, // se actualiza
          gracePeriodStartedAt: '2026-09-16', // NO cambia
          gracePeriodEndsAt: '2026-09-20', // NO cambia
        }),
      );
    });

    it('persiste el cambio de estado a VENCIDA aunque el recordatorio de vencimiento ya se haya enviado antes (guardado desacoplado del recordatorio)', async () => {
      invoiceRepo.find.mockResolvedValue([
        makeInvoice({
          dueDate: '2026-09-15',
          status: 'EN_GRACIA',
          daysOverdue: 4,
          gracePeriodStartedAt: '2026-09-16',
          gracePeriodEndsAt: '2026-09-20',
          overdueReminderSentAt: new Date('2026-09-17'), // ya se envió, no debe volver a enviarse
        }),
      ]);

      // referencia 2026-09-21 => 6 días vencido, gracia=5 => cruza a VENCIDA
      const result = await service.runMorosidadCycle(new Date(2026, 8, 21));

      expect(result.overdueRemindersSent).toBe(0); // no se reenvía
      expect(invoiceRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'VENCIDA', daysOverdue: 6 }));
    });

    it('no vuelve a guardar la factura si ni el estado ni los días de atraso cambiaron y no hay recordatorio que enviar', async () => {
      invoiceRepo.find.mockResolvedValue([
        makeInvoice({
          dueDate: '2026-09-15',
          status: 'VENCIDA',
          daysOverdue: 6,
          gracePeriodStartedAt: '2026-09-16',
          gracePeriodEndsAt: '2026-09-20',
          overdueReminderSentAt: new Date('2026-09-17'),
        }),
      ]);

      // misma fecha de referencia => mismo daysOverdue (6), mismo estado (VENCIDA)
      await service.runMorosidadCycle(new Date(2026, 8, 21));

      expect(invoiceRepo.save).not.toHaveBeenCalled();
    });

    it('una factura VENCIDA sigue contando para la suspensión del contrato igual que antes', async () => {
      invoiceRepo.find.mockResolvedValue([
        makeInvoice({ dueDate: '2026-09-15', status: 'EN_GRACIA', daysOverdue: 4 }),
      ]);

      const result = await service.runMorosidadCycle(new Date(2026, 8, 21));

      expect(result.contractsSuspended).toBe(1);
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
        expect.objectContaining({
          contractId: 'contract-1',
          clientId: 'client-1',
          reason: 'Reactivación automática: facturas vencidas liquidadas.',
        }),
      );
      expect(suspensionHistoryService.closeSuspension).toHaveBeenCalledWith('contract-1', {
        reconnectionFeeInvoiceId: undefined,
      });
    });

    it('propaga el reconnectionFeeInvoiceId al cerrar el historial de suspensión cuando se cobró un cargo de reconexión', async () => {
      contractRepo.findOneBy.mockResolvedValue({
        id: 'contract-1',
        contractNumber: 'CTR-0001',
        status: 'SUSPENDED',
        clientId: 'client-1',
      });
      invoiceRepo.count.mockResolvedValue(0);

      await service.reactivateIfSettled('contract-1', 'inv-fee-1');

      expect(suspensionHistoryService.closeSuspension).toHaveBeenCalledWith('contract-1', {
        reconnectionFeeInvoiceId: 'inv-fee-1',
      });
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

  describe('getDelinquents (RF-BILL-001)', () => {
    it('retorna la lista operativa de morosos con estado de red y medio de suspensión', async () => {
      invoiceRepo.find.mockResolvedValue([
        makeInvoice({
          id: 'inv-1',
          clientId: 'client-1',
          contractId: 'contract-1',
          dueDate: '2026-09-01',
          grandTotal: 1200,
          client: { id: 'client-1', name: 'Santo Cliente', docNumber: '402-0000000-1', phone: '809-555-0101' } as any,
          contract: {
            id: 'contract-1',
            clientId: 'client-1',
            contractNumber: 'CTR-001',
            status: 'ACTIVE',
            billingDay: 1,
            graceDaysOverride: 7,
            plan: { name: 'Fibra 200M' },
          } as any,
        }),
      ]);

      accessRepo.find.mockResolvedValue([
        {
          id: 'acc-1',
          contractId: 'contract-1',
          username: 'santo_pppoe',
          nodeId: 'node-1',
          node: { id: 'node-1', name: 'Nodo Central', status: 'ACTIVE' },
          pendingOperation: null,
        },
      ]);

      portRegistry.resolveSuspensionMedium.mockReturnValue('PPPOE');

      const result = await service.getDelinquents({}, new Date(2026, 8, 10));

      expect(result.summary.totalDelinquentContracts).toBe(1);
      expect(result.summary.totalOverdueAmount).toBe(1200);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          clientId: 'client-1',
          clientName: 'Santo Cliente',
          contractNumber: 'CTR-001',
          effectiveGraceDays: 7,
          graceDaysOverride: 7,
          suspensionMedium: 'PPPOE',
          networkStatus: expect.objectContaining({
            nodeName: 'Nodo Central',
            isDeviceOnline: true,
          }),
        }),
      );
    });

    it('respeta el graceDaysOverride del contrato para no suspender prematuramente', async () => {
      // dueDate 2026-09-01, hoy 2026-09-05 (4 días de atraso)
      // settings global: 3 días (lo suspendería)
      // pero contrato tiene graceDaysOverride: 7 días (no debe suspenderse aún)
      billingSettingsService.getSettings.mockResolvedValue({
        graceDaysBeforeSuspension: 3,
        reminderDaysAfterDue: 1,
        advanceReminderDaysBeforeDue: 2,
      });

      const invoice = makeInvoice({
        id: 'inv-1',
        contractId: 'contract-1',
        dueDate: '2026-09-01',
        contract: {
          id: 'contract-1',
          contractNumber: 'CTR-001',
          status: 'ACTIVE',
          graceDaysOverride: 7,
        } as any,
      });
      invoiceRepo.find.mockResolvedValue([invoice]);

      const result = await service.runMorosidadCycle(new Date(2026, 8, 5));

      expect(result.contractsSuspended).toBe(0);
      expect(serviceControlService.suspendService).not.toHaveBeenCalled();
    });

    it('mantiene el contrato ACTIVE con pendingOperation si el equipo está offline (RF-BILL-002)', async () => {
      // 6 días de atraso con gracia de 5 días => debe suspender
      const invoice = makeInvoice({
        id: 'inv-1',
        contractId: 'contract-1',
        dueDate: '2026-09-01',
        contract: {
          id: 'contract-1',
          contractNumber: 'CTR-001',
          status: 'ACTIVE',
        } as any,
      });
      invoiceRepo.find.mockResolvedValue([invoice]);

      // Simulamos que el router está offline
      serviceControlService.suspendService.mockResolvedValue({
        applied: false,
        errorCode: 'NET_DEVICE_OFFLINE',
        medium: 'PPPOE',
        verified: false,
      });

      const result = await service.runMorosidadCycle(new Date(2026, 8, 7));

      // El contrato no debe pasar a SUSPENDED en la BD
      expect(contractRepo.save).not.toHaveBeenCalled();
      expect(suspensionHistoryService.openSuspension).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(SystemEvents.CONTRACT_SUSPENDED, expect.anything());
    });
  });
});
