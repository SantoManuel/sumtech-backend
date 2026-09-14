import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PosService } from './pos.service';
import { SaleEntity } from './entities/sale.entity';
import { CashRegisterEntity } from './entities/cash-register.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { ClientEntity } from '../clients/entities/client.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { InventoryService } from '../inventory/inventory.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { MorosidadService } from '../billing/morosidad.service';

describe('PosService', () => {
  let service: PosService;
  let clientRepo: any;
  let saleRepo: any;
  let cashRegisterRepo: any;
  let contractRepo: any;
  let invoiceRepo: any;
  let inventoryService: any;
  let invoicingService: any;
  let morosidadService: any;
  let dataSource: any;
  let queryRunner: any;

  beforeEach(async () => {
    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        getRepository: jest.fn((entity) => ({
          create: jest.fn((dto) => dto),
          save: jest.fn((entity) => Promise.resolve({ id: 'saved-id', ...entity })),
          findOne: jest.fn().mockResolvedValue({ id: 'contract-1', billingDay: 15, status: 'SUSPENDED' }),
        })),
      },
    };

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    clientRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'client-1',
        name: 'Carlos Ruiz',
        contracts: [{ id: 'contract-1', billingDay: 15 }],
      }),
    };

    saleRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'saved-id',
        grandTotal: 1500,
        invoice: { ncfNumber: 'E3100000001' },
      }),
    };

    cashRegisterRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'cr-1', status: 'OPEN', openingAmount: 2000 }),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => Promise.resolve({ id: 'cr-1', ...dto })),
    };

    contractRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'contract-1', billingDay: 15 }),
      save: jest.fn((dto) => Promise.resolve(dto)),
    };

    inventoryService = {
      reserveStockForSale: jest.fn().mockResolvedValue(true),
    };

    invoicingService = {
      emitInvoice: jest.fn().mockResolvedValue({
        id: 'inv-1',
        ncfNumber: 'E3100000001',
        securityCode: 'A1B2C3',
        dgiiStatus: 'ACCEPTED',
      }),
      settleInvoice: jest.fn().mockImplementation((invoiceId: string, sale: any) =>
        Promise.resolve({ id: invoiceId, saleId: sale.id, status: 'ISSUED', ncfNumber: 'E3200000001' }),
      ),
    };

    morosidadService = {
      reactivateIfSettled: jest.fn().mockResolvedValue(false),
    };

    invoiceRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PosService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: InventoryService, useValue: inventoryService },
        { provide: InvoicingService, useValue: invoicingService },
        { provide: MorosidadService, useValue: morosidadService },
        { provide: getRepositoryToken(SaleEntity), useValue: saleRepo },
        { provide: getRepositoryToken(CashRegisterEntity), useValue: cashRegisterRepo },
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: getRepositoryToken(ClientEntity), useValue: clientRepo },
        { provide: getRepositoryToken(InvoiceEntity), useValue: invoiceRepo },
      ],
    }).compile();

    service = module.get<PosService>(PosService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debe procesar un checkout con ajuste de día de corte del suscriptor y timbrado e-CF', async () => {
    const checkoutDto: any = {
      clientId: 'client-1',
      contractId: 'contract-1',
      billingDay: 20, // Cliente solicita cambiar su fecha de pago al día 20
      billingPeriod: 'Septiembre 2026',
      items: [
        {
          itemType: 'PLAN_SUBSCRIPTION',
          concept: 'Mensualidad Fibra Óptica 200 Mbps',
          quantity: 1,
          unitPrice: 1500,
          itbisAmount: 270,
        },
      ],
      paymentMethod: 'CASH',
      ncfType: 'E31',
    };

    const result = await service.checkout('user-admin-1', checkoutDto);

    expect(result).toBeDefined();
    expect(queryRunner.startTransaction).toHaveBeenCalled();
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(invoicingService.emitInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ ncfType: 'E31' }),
      queryRunner,
    );
  });

  it('debe permitir abrir un turno de caja si no hay uno previo abierto', async () => {
    cashRegisterRepo.findOne.mockResolvedValue(null);
    const shift = await service.openCashRegister('user-1', {
      openingAmount: 3000,
      notes: 'Turno de la mañana',
    });

    expect(shift).toBeDefined();
    expect(cashRegisterRepo.save).toHaveBeenCalled();
  });

  describe('collectInvoices', () => {
    const makePendingInvoice = (overrides: Record<string, any> = {}) => ({
      id: 'inv-1',
      clientId: 'client-1',
      contractId: 'contract-1',
      status: 'PENDING_PAYMENT',
      subtotal: 2195,
      itbisTotal: 395.1,
      grandTotal: 2634,
      dueDate: '2026-09-15',
      billingPeriodStart: '2026-09-01',
      concept: 'Combo Dúo - Septiembre 2026',
      ...overrides,
    });

    it('lanza NotFoundException si alguna factura indicada no existe', async () => {
      invoiceRepo.find.mockResolvedValue([makePendingInvoice()]);

      await expect(
        service.collectInvoices('user-1', {
          invoiceIds: ['inv-1', 'inv-2'],
          paymentMethod: 'CASH',
          ncfType: 'E32',
        } as any),
      ).rejects.toThrow('Una o más facturas indicadas no existen');
    });

    it('lanza BadRequestException si las facturas pertenecen a distintos clientes', async () => {
      invoiceRepo.find.mockResolvedValue([
        makePendingInvoice({ id: 'inv-1', clientId: 'client-1' }),
        makePendingInvoice({ id: 'inv-2', clientId: 'client-2' }),
      ]);

      await expect(
        service.collectInvoices('user-1', {
          invoiceIds: ['inv-1', 'inv-2'],
          paymentMethod: 'CASH',
          ncfType: 'E32',
        } as any),
      ).rejects.toThrow('Todas las facturas a cobrar deben pertenecer al mismo cliente');
    });

    it('lanza ConflictException si alguna factura ya no está PENDING_PAYMENT', async () => {
      invoiceRepo.find.mockResolvedValue([makePendingInvoice({ status: 'ISSUED' })]);

      await expect(
        service.collectInvoices('user-1', {
          invoiceIds: ['inv-1'],
          paymentMethod: 'CASH',
          ncfType: 'E32',
        } as any),
      ).rejects.toThrow('ya no están pendientes de pago');
    });

    it('cobra las facturas pendientes, liquida cada una vía settleInvoice y reactiva contratos afectados', async () => {
      invoiceRepo.find.mockResolvedValue([makePendingInvoice()]);

      const result = await service.collectInvoices('user-1', {
        cashRegisterId: 'cr-1',
        invoiceIds: ['inv-1'],
        paymentMethod: 'CASH',
        ncfType: 'E32',
      } as any);

      expect(result).toHaveLength(1);
      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(invoicingService.settleInvoice).toHaveBeenCalledWith(
        'inv-1',
        expect.objectContaining({ clientId: 'client-1', contractId: 'contract-1' }),
        'E32',
        queryRunner,
      );
      expect(morosidadService.reactivateIfSettled).toHaveBeenCalledWith('contract-1');
    });

    it('no emite SALE_CONFIRMED (evitaría crear un ticket de instalación espurio en cada cobro mensual)', async () => {
      invoiceRepo.find.mockResolvedValue([makePendingInvoice()]);
      const emitSpy = jest.fn();
      (service as any).eventEmitter = { emit: emitSpy };

      await service.collectInvoices('user-1', {
        cashRegisterId: 'cr-1',
        invoiceIds: ['inv-1'],
        paymentMethod: 'CASH',
        ncfType: 'E32',
      } as any);

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('hace rollback y no reactiva ningún contrato si settleInvoice falla', async () => {
      invoiceRepo.find.mockResolvedValue([makePendingInvoice()]);
      invoicingService.settleInvoice.mockRejectedValueOnce(new Error('DGII no disponible'));

      await expect(
        service.collectInvoices('user-1', {
          cashRegisterId: 'cr-1',
          invoiceIds: ['inv-1'],
          paymentMethod: 'CASH',
          ncfType: 'E32',
        } as any),
      ).rejects.toThrow('DGII no disponible');

      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(morosidadService.reactivateIfSettled).not.toHaveBeenCalled();
    });

    it('cobra varias facturas de contratos distintos en una sola transacción y reactiva cada contrato afectado', async () => {
      invoiceRepo.find.mockResolvedValue([
        makePendingInvoice({ id: 'inv-1', contractId: 'contract-1' }),
        makePendingInvoice({ id: 'inv-2', contractId: 'contract-2' }),
      ]);

      const result = await service.collectInvoices('user-1', {
        cashRegisterId: 'cr-1',
        invoiceIds: ['inv-1', 'inv-2'],
        paymentMethod: 'CASH',
        ncfType: 'E32',
      } as any);

      expect(result).toHaveLength(2);
      expect(invoicingService.settleInvoice).toHaveBeenCalledTimes(2);
      expect(morosidadService.reactivateIfSettled).toHaveBeenCalledWith('contract-1');
      expect(morosidadService.reactivateIfSettled).toHaveBeenCalledWith('contract-2');
    });
  });
});
