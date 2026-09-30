import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BillingCycleService } from './billing-cycle.service';
import { ContractEntity } from '../clients/entities/contract.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { SystemEvents } from '../../common/enums/system-events.enum';
import { TenantIteratorService } from '../../common/tenancy/tenant-iterator.service';

describe('BillingCycleService', () => {
  let service: BillingCycleService;
  let contractRepo: any;
  let invoiceRepo: any;
  let eventEmitter: any;

  const makeContract = (overrides: Partial<ContractEntity> = {}): ContractEntity =>
    ({
      id: 'contract-1',
      contractNumber: 'CTR-0001',
      clientId: 'client-1',
      planId: 'plan-1',
      billingDay: 15,
      status: 'ACTIVE',
      plan: {
        id: 'plan-1',
        name: 'Fibra 100 Mbps',
        monthlyPrice: 2000,
        itbisRate: 0.18,
        cdtRate: 0.02,
      },
      ...overrides,
    }) as ContractEntity;

  beforeEach(async () => {
    contractRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    invoiceRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto) => ({ ...dto, id: 'inv-generated' })),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };
    eventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingCycleService,
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: getRepositoryToken(InvoiceEntity), useValue: invoiceRepo },
        { provide: EventEmitter2, useValue: eventEmitter },
        {
          provide: TenantIteratorService,
          useValue: { runForEachActiveTenant: jest.fn((_label: string, fn: (t: any) => Promise<void>) => fn({ slug: 'tenant-test' })) },
        },
      ],
    }).compile();

    service = module.get<BillingCycleService>(BillingCycleService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('genera una factura PENDING_PAYMENT cuando el día de hoy coincide con el día de corte del contrato', async () => {
    contractRepo.find.mockResolvedValue([makeContract({ billingDay: 15 })]);
    const referenceDate = new Date(2026, 8, 15); // 15 de septiembre de 2026

    const result = await service.runBillingCycle(referenceDate);

    expect(result).toEqual({ generated: 1, skipped: 0, failed: 0 });
    expect(invoiceRepo.save).toHaveBeenCalledTimes(1);

    const savedInvoice = invoiceRepo.create.mock.calls[0][0];
    expect(savedInvoice.status).toBe('PENDING_PAYMENT');
    expect(savedInvoice.clientId).toBe('client-1');
    expect(savedInvoice.contractId).toBe('contract-1');
    expect(savedInvoice.billingPeriodStart).toBe('2026-09-01');
    expect(savedInvoice.billingPeriodEnd).toBe('2026-09-30');
    expect(savedInvoice.dueDate).toBe('2026-09-15');
    expect(savedInvoice.subtotal).toBe(2000);
    expect(savedInvoice.itbisTotal).toBe(360); // 2000 * 0.18
    expect(savedInvoice.cdtAmount).toBe(40); // 2000 * 0.02
    expect(savedInvoice.grandTotal).toBe(2400); // 2000 + 360 + 40
    expect(savedInvoice.concept).toContain('Fibra 100 Mbps');
    expect(savedInvoice.concept).toContain('septiembre de 2026');

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      SystemEvents.INVOICE_GENERATED,
      expect.objectContaining({
        clientId: 'client-1',
        contractId: 'contract-1',
        grandTotal: 2400,
        dueDate: '2026-09-15',
      }),
    );
  });

  it('no genera factura si el día de hoy no coincide con el día de corte del contrato', async () => {
    contractRepo.find.mockResolvedValue([makeContract({ billingDay: 20 })]);
    const referenceDate = new Date(2026, 8, 15);

    const result = await service.runBillingCycle(referenceDate);

    expect(result).toEqual({ generated: 0, skipped: 1, failed: 0 });
    expect(invoiceRepo.save).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('aplica clamping cuando el día de corte excede los días del mes (ej. billingDay=31 en abril de 30 días)', async () => {
    contractRepo.find.mockResolvedValue([makeContract({ billingDay: 31 })]);
    const referenceDate = new Date(2026, 3, 30); // 30 de abril de 2026 (abril tiene 30 días)

    const result = await service.runBillingCycle(referenceDate);

    expect(result.generated).toBe(1);
    const savedInvoice = invoiceRepo.create.mock.calls[0][0];
    expect(savedInvoice.dueDate).toBe('2026-04-30');
    expect(savedInvoice.billingPeriodStart).toBe('2026-04-01');
    expect(savedInvoice.billingPeriodEnd).toBe('2026-04-30');
  });

  it('aplica clamping correctamente en febrero (28 días, año no bisiesto)', async () => {
    contractRepo.find.mockResolvedValue([makeContract({ billingDay: 31 })]);
    const referenceDate = new Date(2026, 1, 28); // 28 de febrero de 2026 (2026 no es bisiesto)

    const result = await service.runBillingCycle(referenceDate);

    expect(result.generated).toBe(1);
    const savedInvoice = invoiceRepo.create.mock.calls[0][0];
    expect(savedInvoice.dueDate).toBe('2026-02-28');
  });

  it('no dispara en el día 29 de un mes clampeado a 28 (el 28 ya generó la factura del período)', async () => {
    contractRepo.find.mockResolvedValue([makeContract({ billingDay: 31 })]);
    const referenceDate = new Date(2026, 1, 27); // 27 de febrero: el día clampeado es 28, no 27

    const result = await service.runBillingCycle(referenceDate);

    expect(result).toEqual({ generated: 0, skipped: 1, failed: 0 });
  });

  it('es idempotente: no genera una segunda factura si ya existe una para el mismo contrato y período', async () => {
    contractRepo.find.mockResolvedValue([makeContract({ billingDay: 15 })]);
    invoiceRepo.findOne.mockResolvedValue({ id: 'existing-invoice' });
    const referenceDate = new Date(2026, 8, 15);

    const result = await service.runBillingCycle(referenceDate);

    expect(result).toEqual({ generated: 0, skipped: 1, failed: 0 });
    expect(invoiceRepo.save).not.toHaveBeenCalled();
  });

  it('SÍ genera una nueva factura si la única existente para ese período fue anulada (VOIDED)', async () => {
    contractRepo.find.mockResolvedValue([makeContract({ billingDay: 15 })]);
    invoiceRepo.findOne.mockResolvedValue({ id: 'voided-invoice', status: 'VOIDED' });
    const referenceDate = new Date(2026, 8, 15);

    const result = await service.runBillingCycle(referenceDate);

    expect(result).toEqual({ generated: 1, skipped: 0, failed: 0 });
    expect(invoiceRepo.save).toHaveBeenCalled();
  });

  it('trata una violación de unicidad (carrera con el índice parcial de la BD) como omitida, no como fallo', async () => {
    contractRepo.find.mockResolvedValue([makeContract({ billingDay: 15 })]);
    invoiceRepo.save.mockRejectedValueOnce({ code: '23505', message: 'duplicate key value violates unique constraint' });
    const referenceDate = new Date(2026, 8, 15);

    const result = await service.runBillingCycle(referenceDate);

    expect(result).toEqual({ generated: 0, skipped: 1, failed: 0 });
  });

  it('un contrato que falla no aborta el lote: los demás contratos se procesan igual', async () => {
    const contractA = makeContract({ id: 'contract-a', contractNumber: 'CTR-A', clientId: 'client-a', billingDay: 15 });
    const contractB = makeContract({ id: 'contract-b', contractNumber: 'CTR-B', clientId: 'client-b', billingDay: 15 });
    contractRepo.find.mockResolvedValue([contractA, contractB]);

    invoiceRepo.findOne
      .mockResolvedValueOnce(null) // contractA
      .mockResolvedValueOnce(null); // contractB

    invoiceRepo.save
      .mockRejectedValueOnce(new Error('DB connection lost')) // contractA falla
      .mockImplementationOnce((entity: any) => Promise.resolve(entity)); // contractB ok

    const referenceDate = new Date(2026, 8, 15);
    const result = await service.runBillingCycle(referenceDate);

    expect(result).toEqual({ generated: 1, skipped: 0, failed: 1 });
  });

  it('calcula montos en 0 de ITBIS/CDT si el plan tiene tasas en 0', async () => {
    contractRepo.find.mockResolvedValue([
      makeContract({
        billingDay: 15,
        plan: { id: 'plan-2', name: 'Plan Exento', monthlyPrice: 1000, itbisRate: 0, cdtRate: 0 } as any,
      }),
    ]);
    const referenceDate = new Date(2026, 8, 15);

    const result = await service.runBillingCycle(referenceDate);

    expect(result.generated).toBe(1);
    const savedInvoice = invoiceRepo.create.mock.calls[0][0];
    expect(savedInvoice.subtotal).toBe(1000);
    expect(savedInvoice.itbisTotal).toBe(0);
    expect(savedInvoice.cdtAmount).toBe(0);
    expect(savedInvoice.grandTotal).toBe(1000);
  });

  it('no procesa contratos si no hay contratos ACTIVE', async () => {
    contractRepo.find.mockResolvedValue([]);
    const referenceDate = new Date(2026, 8, 15);

    const result = await service.runBillingCycle(referenceDate);

    expect(result).toEqual({ generated: 0, skipped: 0, failed: 0 });
    expect(contractRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' } }),
    );
  });

  describe('generateInitialProratedInvoiceIfNeeded (prorrateo)', () => {
    const makeSettings = (overrides: Partial<{ prorationDayCountPolicy: string }> = {}) =>
      ({ prorationDayCountPolicy: 'FIXED_30', ...overrides }) as any;

    it('prorratea con política FIXED_30: contrato activado el 20/09 (11 días de 30) en septiembre (30 días reales)', async () => {
      const contract = makeContract({ startDate: '2026-09-20' });

      const invoice = await service.generateInitialProratedInvoiceIfNeeded(contract, makeSettings());

      expect(invoice).not.toBeNull();
      const created = invoiceRepo.create.mock.calls[0][0];
      expect(created.isProrated).toBe(true);
      expect(created.proratedDays).toBe(11); // 20..30 de septiembre = 11 días
      expect(created.cycleDays).toBe(30);
      expect(created.subtotal).toBe(733.33); // round(2000/30*11, 2)
      expect(created.dueDate).toBe('2026-09-20');
      expect(created.billingPeriodStart).toBe('2026-09-01');
      expect(created.billingPeriodEnd).toBe('2026-09-30');
      expect(created.prorationDayCountPolicy).toBe('FIXED_30');
    });

    it('prorratea con política ACTUAL_MONTH_DAYS: mismo caso pero usando los días reales del mes (30 en septiembre, igual que FIXED_30 aquí)', async () => {
      const contract = makeContract({ startDate: '2026-09-20' });

      await service.generateInitialProratedInvoiceIfNeeded(contract, makeSettings({ prorationDayCountPolicy: 'ACTUAL_MONTH_DAYS' }));

      const created = invoiceRepo.create.mock.calls[0][0];
      expect(created.cycleDays).toBe(30);
      expect(created.subtotal).toBe(733.33);
    });

    it('ACTUAL_MONTH_DAYS difiere de FIXED_30 en un mes de 31 días (ej. octubre)', async () => {
      const contract = makeContract({ startDate: '2026-10-20' }); // octubre tiene 31 días, quedan 12 (20..31)

      await service.generateInitialProratedInvoiceIfNeeded(contract, makeSettings({ prorationDayCountPolicy: 'ACTUAL_MONTH_DAYS' }));

      const created = invoiceRepo.create.mock.calls[0][0];
      expect(created.cycleDays).toBe(31);
      expect(created.proratedDays).toBe(12);
      expect(created.subtotal).toBe(774.19); // round(2000/31*12, 2)
    });

    it('activación el día 1 del mes: no prorratea, cobra el precio completo (caso borde, sin caso especial en el código)', async () => {
      const contract = makeContract({ startDate: '2026-09-01' });

      await service.generateInitialProratedInvoiceIfNeeded(contract, makeSettings());

      const created = invoiceRepo.create.mock.calls[0][0];
      expect(created.isProrated).toBe(false);
      expect(created.proratedDays).toBe(30);
      expect(created.subtotal).toBe(2000);
      expect(created.grandTotal).toBe(2400);
    });

    it('activación el día 1 en un mes de 31 días con FIXED_30: nunca cobra de más (se limita a cycleDays, no a los días reales)', async () => {
      const contract = makeContract({ startDate: '2026-10-01' }); // octubre = 31 días reales, FIXED_30 = 30

      await service.generateInitialProratedInvoiceIfNeeded(contract, makeSettings());

      const created = invoiceRepo.create.mock.calls[0][0];
      expect(created.isProrated).toBe(false); // efectivamente el mes completo, no se cobra de más
      expect(created.proratedDays).toBe(30);
      expect(created.subtotal).toBe(2000); // nunca 2066.67 (31/30 * 2000)
    });

    it('es idempotente: devuelve null si ya existe una factura para ese (contrato, período) — condición de carrera 23505', async () => {
      const contract = makeContract({ startDate: '2026-09-20' });
      invoiceRepo.save.mockRejectedValueOnce({ code: '23505', message: 'duplicate key' });

      const invoice = await service.generateInitialProratedInvoiceIfNeeded(contract, makeSettings());

      expect(invoice).toBeNull();
    });

    it('propaga un error real (no 23505) en vez de tragárselo', async () => {
      const contract = makeContract({ startDate: '2026-09-20' });
      invoiceRepo.save.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(
        service.generateInitialProratedInvoiceIfNeeded(contract, makeSettings()),
      ).rejects.toThrow('DB connection lost');
    });

    it('lanza si contract.plan no viene cargado (precondición documentada del método)', async () => {
      const contract = makeContract({ startDate: '2026-09-20', plan: undefined as any });

      await expect(
        service.generateInitialProratedInvoiceIfNeeded(contract, makeSettings()),
      ).rejects.toThrow('contract.plan');
    });

    it('emite INVOICE_GENERATED con los datos de la factura prorrateada', async () => {
      const contract = makeContract({ startDate: '2026-09-20' });

      await service.generateInitialProratedInvoiceIfNeeded(contract, makeSettings());

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        SystemEvents.INVOICE_GENERATED,
        expect.objectContaining({ clientId: 'client-1', contractId: 'contract-1', dueDate: '2026-09-20' }),
      );
    });
  });
});
