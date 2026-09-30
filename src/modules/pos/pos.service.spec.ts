import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TENANT_DATA_SOURCE } from '../../common/tenancy/tenant-datasource.provider';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SystemEvents } from '../../common/enums/system-events.enum';
import { PosService } from './pos.service';
import { SaleEntity } from './entities/sale.entity';
import { CashRegisterEntity } from './entities/cash-register.entity';
import { CashStationEntity } from './entities/cash-station.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { ClientEntity } from '../clients/entities/client.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { EmployeeEntity } from '../employees/entities/employee.entity';
import { InventoryService } from '../inventory/inventory.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { MorosidadService } from '../billing/morosidad.service';
import { BillingSettingsService } from '../billing/billing-settings.service';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';

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
  let usersService: any;
  let authService: any;
  let billingSettingsService: any;
  let dataSource: any;
  let queryRunner: any;

  beforeEach(async () => {
    // Memoizado por entidad (no un objeto nuevo en cada llamada): así un test
    // puede inspeccionar después `queryRunner.manager.getRepository(X).create.mock.calls`
    // y ver las llamadas reales hechas durante la transacción, igual que con
    // un Repository real de TypeORM (mismo repo para la misma entidad).
    const queryRunnerRepos = new Map<any, any>();
    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        getRepository: jest.fn((entity) => {
          if (!queryRunnerRepos.has(entity)) {
            queryRunnerRepos.set(entity, {
              create: jest.fn((dto) => dto),
              save: jest.fn((entity) => Promise.resolve({ id: 'saved-id', ...entity })),
              findOne: jest.fn().mockResolvedValue({ id: 'contract-1', billingDay: 15, status: 'SUSPENDED' }),
            });
          }
          return queryRunnerRepos.get(entity);
        }),
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
      findOneBy: jest.fn().mockResolvedValue({ id: 'contract-1', clientId: 'client-1', status: 'SUSPENDED' }),
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

    billingSettingsService = {
      getSettings: jest.fn().mockResolvedValue({ reconnectionFeeAmount: 500, cashierDiscountCapAmount: 500 }),
    };

    usersService = {
      findById: jest.fn().mockResolvedValue({
        id: 'user-1',
        username: 'cajero1',
        roles: [{ name: 'CAJERO' }],
      }),
    };

    authService = {
      verifySupervisorCredentials: jest.fn().mockResolvedValue({
        id: 'supervisor-1',
        username: 'admin',
        email: 'admin@sumtech.com',
      }),
    };

    invoiceRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    const cashStationRepo: any = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => Promise.resolve({ id: 'station-1', ...dto })),
    };

    const employeeRepo: any = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PosService,
        { provide: TENANT_DATA_SOURCE, useValue: dataSource },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: InventoryService, useValue: inventoryService },
        { provide: InvoicingService, useValue: invoicingService },
        { provide: MorosidadService, useValue: morosidadService },
        { provide: BillingSettingsService, useValue: billingSettingsService },
        { provide: UsersService, useValue: usersService },
        { provide: AuthService, useValue: authService },
        { provide: getRepositoryToken(SaleEntity), useValue: saleRepo },
        { provide: getRepositoryToken(CashRegisterEntity), useValue: cashRegisterRepo },
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: getRepositoryToken(ClientEntity), useValue: clientRepo },
        { provide: getRepositoryToken(InvoiceEntity), useValue: invoiceRepo },
        { provide: getRepositoryToken(CashStationEntity), useValue: cashStationRepo },
        { provide: getRepositoryToken(EmployeeEntity), useValue: employeeRepo },
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

    it('lanza ConflictException si alguna factura ya no está PENDING_PAYMENT/EN_GRACIA/VENCIDA', async () => {
      invoiceRepo.find.mockResolvedValue([makePendingInvoice({ status: 'ISSUED' })]);

      await expect(
        service.collectInvoices('user-1', {
          invoiceIds: ['inv-1'],
          paymentMethod: 'CASH',
          ncfType: 'E32',
        } as any),
      ).rejects.toThrow('ya no están pendientes de pago');
    });

    it('SÍ permite cobrar una factura EN_GRACIA (regresión: no debe volverse incobrable al envejecer)', async () => {
      invoiceRepo.find.mockResolvedValue([makePendingInvoice({ status: 'EN_GRACIA' })]);

      const result = await service.collectInvoices('user-1', {
        cashRegisterId: 'cr-1',
        invoiceIds: ['inv-1'],
        paymentMethod: 'CASH',
        ncfType: 'E32',
      } as any);

      expect(result).toHaveLength(1);
      expect(invoicingService.settleInvoice).toHaveBeenCalledWith('inv-1', expect.anything(), 'E32', queryRunner);
    });

    it('SÍ permite cobrar una factura VENCIDA (regresión: no debe volverse incobrable al envejecer)', async () => {
      invoiceRepo.find.mockResolvedValue([makePendingInvoice({ status: 'VENCIDA' })]);

      const result = await service.collectInvoices('user-1', {
        cashRegisterId: 'cr-1',
        invoiceIds: ['inv-1'],
        paymentMethod: 'CASH',
        ncfType: 'E32',
      } as any);

      expect(result).toHaveLength(1);
      expect(invoicingService.settleInvoice).toHaveBeenCalledWith('inv-1', expect.anything(), 'E32', queryRunner);
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
      expect(morosidadService.reactivateIfSettled).toHaveBeenCalledWith('contract-1', undefined);
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

      expect(emitSpy).not.toHaveBeenCalledWith(SystemEvents.SALE_CONFIRMED, expect.anything());
      expect(emitSpy).toHaveBeenCalledWith(SystemEvents.INVOICE_PAID, expect.objectContaining({ invoiceId: 'inv-1' }));
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
      expect(morosidadService.reactivateIfSettled).toHaveBeenCalledWith('contract-1', undefined);
      expect(morosidadService.reactivateIfSettled).toHaveBeenCalledWith('contract-2', undefined);
    });

    describe('applyReconnectionFee', () => {
      it('cobra el cargo de reconexión configurado junto con las facturas del lote y reactiva pasando el id de la factura del cargo', async () => {
        invoiceRepo.find.mockResolvedValue([makePendingInvoice({ contractId: 'contract-1' })]);

        const result = await service.collectInvoices('user-1', {
          cashRegisterId: 'cr-1',
          invoiceIds: ['inv-1'],
          paymentMethod: 'CASH',
          ncfType: 'E32',
          applyReconnectionFee: true,
        } as any);

        // 1 factura recurrente + 1 venta ad-hoc del cargo de reconexión
        expect(result).toHaveLength(2);
        expect(invoicingService.emitInvoice).toHaveBeenCalledWith(
          expect.objectContaining({ ncfType: 'E32' }),
          queryRunner,
        );
        expect(morosidadService.reactivateIfSettled).toHaveBeenCalledWith('contract-1', 'inv-1');
      });

      it('el monto del cargo se calcula desde BillingSettingsEntity.reconnectionFeeAmount, no de un valor fijo en el código', async () => {
        invoiceRepo.find.mockResolvedValue([makePendingInvoice({ contractId: 'contract-1' })]);
        const settingsSpy = jest.fn().mockResolvedValue({ reconnectionFeeAmount: 750 });
        (service as any).billingSettingsService = { getSettings: settingsSpy };

        await service.collectInvoices('user-1', {
          cashRegisterId: 'cr-1',
          invoiceIds: ['inv-1'],
          paymentMethod: 'CASH',
          ncfType: 'E32',
          applyReconnectionFee: true,
        } as any);

        expect(settingsSpy).toHaveBeenCalled();
        const feeSaleCreateCalls = queryRunner.manager.getRepository(SaleEntity).create.mock.calls;
        const feeSaleCall = feeSaleCreateCalls.find((c: any) => c[0].subtotal === 750);
        expect(feeSaleCall).toBeDefined();
      });

      it('rechaza con BadRequestException si el contrato de las facturas no está SUSPENDED', async () => {
        invoiceRepo.find.mockResolvedValue([makePendingInvoice({ contractId: 'contract-1' })]);
        contractRepo.findOneBy.mockResolvedValue({ id: 'contract-1', clientId: 'client-1', status: 'ACTIVE' });

        await expect(
          service.collectInvoices('user-1', {
            invoiceIds: ['inv-1'],
            paymentMethod: 'CASH',
            ncfType: 'E32',
            applyReconnectionFee: true,
          } as any),
        ).rejects.toThrow('SUSPENDED');
      });

      it('rechaza con BadRequestException si las facturas del lote pertenecen a más de un contrato', async () => {
        invoiceRepo.find.mockResolvedValue([
          makePendingInvoice({ id: 'inv-1', contractId: 'contract-1' }),
          makePendingInvoice({ id: 'inv-2', contractId: 'contract-2' }),
        ]);

        await expect(
          service.collectInvoices('user-1', {
            invoiceIds: ['inv-1', 'inv-2'],
            paymentMethod: 'CASH',
            ncfType: 'E32',
            applyReconnectionFee: true,
          } as any),
        ).rejects.toThrow('único contrato');
      });

      it('sin applyReconnectionFee no valida el estado del contrato ni cobra ningún cargo adicional', async () => {
        invoiceRepo.find.mockResolvedValue([makePendingInvoice({ contractId: 'contract-1' })]);
        contractRepo.findOneBy.mockClear();

        const result = await service.collectInvoices('user-1', {
          cashRegisterId: 'cr-1',
          invoiceIds: ['inv-1'],
          paymentMethod: 'CASH',
          ncfType: 'E32',
        } as any);

        expect(result).toHaveLength(1);
        expect(contractRepo.findOneBy).not.toHaveBeenCalled();
      });
    });

    describe('Descuentos manuales y autorización de supervisor (Fase 4)', () => {
      const baseCheckoutDto: any = {
        clientId: 'client-1',
        contractId: 'contract-1',
        billingDay: 15,
        billingPeriod: 'Septiembre 2026',
        items: [
          {
            itemType: 'PLAN_SUBSCRIPTION',
            concept: 'Internet 100 Mbps',
            quantity: 1,
            unitPrice: 1000,
            itbisAmount: 180,
          },
        ],
        paymentMethod: 'CASH',
        ncfType: 'E32',
      };

      it('permite aplicar un descuento dentro del tope de cajero sin credenciales de supervisor', async () => {
        const result = await service.checkout('user-1', {
          ...baseCheckoutDto,
          discountAmount: 300, // Menor al tope de 500
          discountReason: 'Campaña fidelización cliente antiguo',
        });

        expect(result).toBeDefined();
        expect(authService.verifySupervisorCredentials).not.toHaveBeenCalled();
      });

      it('rechaza con BadRequestException si se aplica un descuento mayor a cero sin especificar el motivo', async () => {
        await expect(
          service.checkout('user-1', {
            ...baseCheckoutDto,
            discountAmount: 200,
            discountReason: '   ', // Motivo vacío
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rechaza con ForbiddenException si un cajero supera el tope de descuento sin suministrar credenciales de supervisor', async () => {
        await expect(
          service.checkout('user-1', {
            ...baseCheckoutDto,
            discountAmount: 700, // Supera el tope de 500
            discountReason: 'Falla masiva en zona',
          }),
        ).rejects.toThrow(ForbiddenException);

        expect(authService.verifySupervisorCredentials).not.toHaveBeenCalled();
      });

      it('autoriza y audita la venta cuando el descuento supera el tope y se suministran credenciales válidas de supervisor', async () => {
        authService.verifySupervisorCredentials.mockResolvedValueOnce({
          id: 'supervisor-99',
          username: 'gerente_zona',
          email: 'gerente@sumtech.com',
        });

        const result = await service.checkout('user-1', {
          ...baseCheckoutDto,
          discountAmount: 800,
          discountReason: 'Acuerdo especial de compensación',
          supervisorEmail: 'gerente@sumtech.com',
          supervisorPassword: 'pass-supervisor',
        });

        expect(result).toBeDefined();
        expect(authService.verifySupervisorCredentials).toHaveBeenCalledWith(
          'gerente@sumtech.com',
          'pass-supervisor',
        );
      });

      it('permite a un ADMIN aplicar un descuento sobre el tope sin requerir autorización de un tercero', async () => {
        usersService.findById.mockResolvedValueOnce({
          id: 'admin-user-id',
          username: 'admin',
          roles: [{ name: 'ADMIN' }],
        });

        const result = await service.checkout('admin-user-id', {
          ...baseCheckoutDto,
          discountAmount: 900,
          discountReason: 'Cortesía institucional',
        });

        expect(result).toBeDefined();
        expect(authService.verifySupervisorCredentials).not.toHaveBeenCalled();
      });

      it('calcula correctamente el monto de descuento cuando se envía como porcentaje', async () => {
        const result = await service.checkout('user-1', {
          ...baseCheckoutDto,
          discountType: 'PERCENTAGE',
          discountPercentage: 20, // 20% de 1000 = 200 (menor al tope de 500)
          discountReason: 'Promoción del mes',
        });

        expect(result).toBeDefined();
        expect(authService.verifySupervisorCredentials).not.toHaveBeenCalled();
      });

      it('aplica el descuento puntual solo a la factura especificada en collectInvoices', async () => {
        invoiceRepo.find.mockResolvedValue([
          makePendingInvoice({ id: 'inv-target', subtotal: 1000, itbisTotal: 180, grandTotal: 1180 }),
          makePendingInvoice({ id: 'inv-other', subtotal: 800, itbisTotal: 144, grandTotal: 944 }),
        ]);

        const result = await service.collectInvoices('user-1', {
          cashRegisterId: 'cr-1',
          invoiceIds: ['inv-target', 'inv-other'],
          paymentMethod: 'CASH',
          ncfType: 'E32',
          discount: {
            invoiceId: 'inv-target',
            type: 'FIXED',
            amount: 300,
            reason: 'Compensación 3 días sin conexión',
          },
        } as any);

        expect(result).toHaveLength(2);
        // Verificamos que se ejecutó settleInvoice para ambas facturas
        expect(invoicingService.settleInvoice).toHaveBeenCalledTimes(2);
      });

      it('rechaza collectInvoices si el invoiceId del descuento no forma parte del lote a cobrar', async () => {
        invoiceRepo.find.mockResolvedValue([
          makePendingInvoice({ id: 'inv-1', subtotal: 1000, itbisTotal: 180, grandTotal: 1180 }),
        ]);

        await expect(
          service.collectInvoices('user-1', {
            cashRegisterId: 'cr-1',
            invoiceIds: ['inv-1'],
            paymentMethod: 'CASH',
            ncfType: 'E32',
            discount: {
              invoiceId: 'inv-distinta-que-no-esta-en-lote',
              amount: 200,
              reason: 'Descuento inválido',
            },
          } as any),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });
});
