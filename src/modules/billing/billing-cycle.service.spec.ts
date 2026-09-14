import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BillingCycleService } from './billing-cycle.service';
import { ContractEntity } from '../clients/entities/contract.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { SystemEvents } from '../../common/enums/system-events.enum';

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
});
