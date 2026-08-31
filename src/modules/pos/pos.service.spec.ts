import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PosService } from './pos.service';
import { SaleEntity } from './entities/sale.entity';
import { CashRegisterEntity } from './entities/cash-register.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { ClientEntity } from '../clients/entities/client.entity';
import { InventoryService } from '../inventory/inventory.service';
import { InvoicingService } from '../invoicing/invoicing.service';

describe('PosService', () => {
  let service: PosService;
  let clientRepo: any;
  let saleRepo: any;
  let cashRegisterRepo: any;
  let contractRepo: any;
  let inventoryService: any;
  let invoicingService: any;
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
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PosService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: InventoryService, useValue: inventoryService },
        { provide: InvoicingService, useValue: invoicingService },
        { provide: getRepositoryToken(SaleEntity), useValue: saleRepo },
        { provide: getRepositoryToken(CashRegisterEntity), useValue: cashRegisterRepo },
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: getRepositoryToken(ClientEntity), useValue: clientRepo },
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
});
