import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InvoicingService } from './invoicing.service';
import { InvoiceEntity } from './entities/invoice.entity';
import { EcfSequenceEntity } from './entities/ecf-sequence.entity';
import { SaleEntity } from '../pos/entities/sale.entity';
import { SaleDetailEntity } from '../pos/entities/sale-detail.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { ProductEntity } from '../inventory/entities/product.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { ClientEntity } from '../clients/entities/client.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { PlanEntity } from '../plans/entities/plan.entity';
import { DgiiXmlGeneratorService } from './dgii/dgii-xml-generator.service';
import { DgiiClientService } from './dgii/dgii-client.service';
import { DgiiSignerService } from './dgii/dgii-signer.service';
import { PdfGeneratorService } from '../printing/pdf-generator.service';
import { DataSource } from 'typeorm';
import { Role } from '../../common/enums/role.enum';

describe('InvoicingService', () => {
  let service: InvoicingService;
  let sequenceRepo: any;
  let invoiceRepo: any;
  let saleRepo: any;
  let qrSaleRepo: any;
  let qrSaleDetailRepo: any;
  let qrInvoiceRepo: any;
  let queryRunnerMock: any;
  let dataSourceMock: any;

  beforeEach(async () => {
    sequenceRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto) => ({ ...dto, id: 'seq-1' })),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    const invoiceQueryBuilder: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    invoiceRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto) => ({ ...dto, id: 'inv-1' })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      createQueryBuilder: jest.fn(() => invoiceQueryBuilder),
    };

    saleRepo = {
      findOne: jest.fn(),
    };

    qrSaleRepo = {
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'credit-sale-1', ...entity })),
    };
    qrSaleDetailRepo = {
      create: jest.fn((dto: any) => dto),
    };
    qrInvoiceRepo = {
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'credit-note-1', ...entity })),
    };

    queryRunnerMock = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        getRepository: jest.fn((entity: any) => {
          if (entity === EcfSequenceEntity) return sequenceRepo;
          if (entity === SaleEntity) return qrSaleRepo;
          if (entity === SaleDetailEntity) return qrSaleDetailRepo;
          if (entity === InvoiceEntity) return qrInvoiceRepo;
          throw new Error(`Entidad no mockeada en queryRunner.manager.getRepository: ${entity?.name}`);
        }),
      },
    };
    dataSourceMock = { createQueryRunner: jest.fn(() => queryRunnerMock) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicingService,
        DgiiXmlGeneratorService,
        DgiiSignerService,
        {
          provide: DgiiClientService,
          useValue: {
            getConfig: jest.fn().mockReturnValue({
              rncEmisor: '131000000',
              razonSocialEmisor: 'SUMTECH TELECOM SRL',
            }),
            submitEcf: jest.fn().mockResolvedValue({
              trackId: 'TRK-DGII-123456',
              status: 'ACCEPTED',
              securityCode: 'A1B2C3',
              qrCodeUrl: 'https://ecf.dgii.gov.do/testecf/consultatimbre?rncemisor=131000000',
              signedXml: '<ECF></ECF>',
              responseMessage: 'Timbrado Aceptado',
              timestamp: new Date(),
            }),
          },
        },
        { provide: getRepositoryToken(InvoiceEntity), useValue: invoiceRepo },
        { provide: getRepositoryToken(EcfSequenceEntity), useValue: sequenceRepo },
        { provide: getRepositoryToken(SaleEntity), useValue: saleRepo },
        { provide: getRepositoryToken(TicketEntity), useValue: {} },
        { provide: getRepositoryToken(ProductEntity), useValue: {} },
        { provide: getRepositoryToken(SerialNumberEntity), useValue: {} },
        { provide: getRepositoryToken(ClientEntity), useValue: {} },
        { provide: getRepositoryToken(ContractEntity), useValue: {} },
        { provide: getRepositoryToken(PlanEntity), useValue: {} },
        {
          provide: PdfGeneratorService,
          useValue: {
            generateInvoiceA4Pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
          },
        },
        { provide: DataSource, useValue: dataSourceMock },
      ],
    }).compile();

    service = module.get<InvoicingService>(InvoicingService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debe generar y reservar la secuencia correlativa de forma correcta para E31', async () => {
    sequenceRepo.findOne.mockResolvedValue({
      id: 'seq-e31',
      ncfType: 'E31',
      currentSequence: 5,
      endSequence: 10000,
      expiryDate: '31-12-2028',
    });

    const result = await service.getNextNcfSequence('E31');
    expect(result.ncfNumber).toBe('E3100000005');
    expect(result.expiryDate).toBe('31-12-2028');
    expect(sequenceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSequence: 6,
      }),
    );
  });

  it('debe emitir y timbrar una factura e-CF asociada a una venta', async () => {
    saleRepo.findOne.mockResolvedValue({
      id: 'sale-100',
      clientId: 'client-1',
      subtotal: 1000,
      itbisTotal: 180,
      grandTotal: 1180,
      client: {
        id: 'client-1',
        name: 'Cliente VIP',
        docType: 'RNC',
        docNumber: '131000001',
      },
      details: [
        {
          itemType: 'PLAN_SUBSCRIPTION',
          concept: 'Fibra Simétrica 100Mbps',
          quantity: 1,
          unitPrice: 1000,
          itbisAmount: 180,
          subtotal: 1000,
        },
      ],
    });

    sequenceRepo.findOne.mockResolvedValue({
      id: 'seq-e31',
      ncfType: 'E31',
      currentSequence: 1,
      endSequence: 1000,
    });

    const invoice = await service.emitInvoice({
      saleId: 'sale-100',
      ncfType: 'E31',
    });

    expect(invoice).toBeDefined();
    expect(invoice.ncfNumber).toBe('E3100000001');
    expect(invoice.dgiiStatus).toBe('ACCEPTED');
    expect(invoice.securityCode).toBe('A1B2C3');
    expect(invoiceRepo.save).toHaveBeenCalled();
  });

  describe('findAll', () => {
    it('aplica paginación por defecto (page=1, limit=15) y devuelve la forma paginada estándar', async () => {
      const result = await service.findAll({});

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 15, totalPages: 0 });
      expect(invoiceRepo.createQueryBuilder).toHaveBeenCalledWith('invoice');
    });

    it('aplica filtros de status y clientId cuando se proveen', async () => {
      const qb = invoiceRepo.createQueryBuilder();
      await service.findAll({ status: 'PENDING_PAYMENT', clientId: 'client-1', page: 2, limit: 10 });

      expect(qb.andWhere).toHaveBeenCalledWith('invoice.status = :status', { status: 'PENDING_PAYMENT' });
      expect(qb.andWhere).toHaveBeenCalledWith('invoice.clientId = :clientId', { clientId: 'client-1' });
      expect(qb.skip).toHaveBeenCalledWith(10);
      expect(qb.take).toHaveBeenCalledWith(10);
    });

    it('sin sortBy/sortDir mantiene el orden actual (issuedAt DESC) usado por /dashboard/facturas', async () => {
      const qb = invoiceRepo.createQueryBuilder();
      await service.findAll({});

      expect(qb.orderBy).toHaveBeenCalledWith('invoice.issuedAt', 'DESC');
    });

    it('aplica sortBy=dueDate/sortDir=ASC cuando se solicita (listado de cobro del POS)', async () => {
      const qb = invoiceRepo.createQueryBuilder();
      await service.findAll({ sortBy: 'dueDate', sortDir: 'ASC' });

      expect(qb.orderBy).toHaveBeenCalledWith('invoice.dueDate', 'ASC');
    });

    it('aplica el rango de fecha de vencimiento (dueDateFrom/dueDateTo) cuando se provee', async () => {
      const qb = invoiceRepo.createQueryBuilder();
      await service.findAll({ dueDateFrom: '2026-08-01', dueDateTo: '2026-08-31' });

      expect(qb.andWhere).toHaveBeenCalledWith('invoice.dueDate >= :dueDateFrom', { dueDateFrom: '2026-08-01' });
      expect(qb.andWhere).toHaveBeenCalledWith('invoice.dueDate <= :dueDateTo', { dueDateTo: '2026-08-31' });
    });

    it('no aplica filtro de fecha de vencimiento cuando no se provee', async () => {
      const qb = invoiceRepo.createQueryBuilder();
      await service.findAll({});

      expect(qb.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('dueDate'), expect.anything());
    });
  });

  it('emitInvoice asigna clientId/contractId/montos propios de la factura (no solo los de la venta)', async () => {
    saleRepo.findOne.mockResolvedValue({
      id: 'sale-100',
      clientId: 'client-1',
      contractId: 'contract-9',
      subtotal: 1000,
      itbisTotal: 180,
      grandTotal: 1180,
      client: { id: 'client-1', name: 'Cliente VIP', docType: 'RNC', docNumber: '131000001' },
      details: [
        {
          itemType: 'PLAN_SUBSCRIPTION',
          concept: 'Fibra Simétrica 100Mbps',
          quantity: 1,
          unitPrice: 1000,
          itbisAmount: 180,
          subtotal: 1000,
        },
      ],
    });
    sequenceRepo.findOne.mockResolvedValue({ id: 'seq-e31', ncfType: 'E31', currentSequence: 1, endSequence: 1000 });

    const invoice = await service.emitInvoice({ saleId: 'sale-100', ncfType: 'E31' });

    expect(invoice.clientId).toBe('client-1');
    expect(invoice.contractId).toBe('contract-9');
    expect(invoice.subtotal).toBe(1000);
    expect(invoice.itbisTotal).toBe(180);
    expect(invoice.grandTotal).toBe(1180);
    expect(invoice.status).toBe('ISSUED');
    expect(invoice.paidAt).toBeInstanceOf(Date);
  });

  describe('UnidadMedida y FechaVencimientoSecuencia en el XML e-CF (RI/DGII)', () => {
    it('declara UnidadMedida=43 (UND) solo para ítems de hardware, y la omite para servicios', async () => {
      saleRepo.findOne.mockResolvedValue({
        id: 'sale-200',
        clientId: 'client-1',
        subtotal: 1500,
        itbisTotal: 270,
        grandTotal: 1770,
        client: { id: 'client-1', name: 'Cliente VIP', docType: 'RNC', docNumber: '131000001' },
        details: [
          { itemType: 'PLAN_SUBSCRIPTION', concept: 'Fibra 100Mbps', quantity: 1, unitPrice: 1000, itbisAmount: 180, subtotal: 1000 },
          { itemType: 'PRODUCT_HARDWARE', concept: 'Router GPON', quantity: 1, unitPrice: 500, itbisAmount: 90, subtotal: 500 },
        ],
      });
      sequenceRepo.findOne.mockResolvedValue({ id: 'seq-e31', ncfType: 'E31', currentSequence: 1, endSequence: 1000, expiryDate: '31-12-2028' });
      const genSpy = jest.spyOn((service as any).xmlGenerator, 'generateEcfXml');

      await service.emitInvoice({ saleId: 'sale-200', ncfType: 'E31' });

      const callArgs = genSpy.mock.calls[0][0] as any;
      expect(callArgs.items[0].unidadMedida).toBeUndefined();
      expect(callArgs.items[1].unidadMedida).toBe(43);
    });

    it('pasa el vencimiento real de la secuencia (no un valor fijo) como FechaVencimientoSecuencia', async () => {
      saleRepo.findOne.mockResolvedValue({
        id: 'sale-201',
        clientId: 'client-1',
        subtotal: 1000,
        itbisTotal: 180,
        grandTotal: 1180,
        client: { id: 'client-1', name: 'Cliente VIP', docType: 'RNC', docNumber: '131000001' },
        details: [{ itemType: 'PLAN_SUBSCRIPTION', concept: 'Fibra 100Mbps', quantity: 1, unitPrice: 1000, itbisAmount: 180, subtotal: 1000 }],
      });
      sequenceRepo.findOne.mockResolvedValue({ id: 'seq-e31', ncfType: 'E31', currentSequence: 1, endSequence: 1000, expiryDate: '15-06-2027' });
      const genSpy = jest.spyOn((service as any).xmlGenerator, 'generateEcfXml');

      await service.emitInvoice({ saleId: 'sale-201', ncfType: 'E31' });

      expect(genSpy).toHaveBeenCalledWith(expect.objectContaining({ fechaVencimientoSecuencia: '15-06-2027' }));
    });

    it('persiste ncfExpiryDate en la factura para E31 (crédito fiscal), no para E32 (consumo)', async () => {
      const baseSale = {
        id: 'sale-202',
        clientId: 'client-1',
        subtotal: 1000,
        itbisTotal: 180,
        grandTotal: 1180,
        client: { id: 'client-1', name: 'Cliente VIP', docType: 'RNC', docNumber: '131000001' },
        details: [{ itemType: 'PLAN_SUBSCRIPTION', concept: 'Fibra 100Mbps', quantity: 1, unitPrice: 1000, itbisAmount: 180, subtotal: 1000 }],
      };

      saleRepo.findOne.mockResolvedValue({ ...baseSale, id: 'sale-e31' });
      sequenceRepo.findOne.mockResolvedValue({ id: 'seq-e31', ncfType: 'E31', currentSequence: 1, endSequence: 1000, expiryDate: '31-12-2028' });
      const e31Invoice = await service.emitInvoice({ saleId: 'sale-e31', ncfType: 'E31' });
      expect(e31Invoice.ncfExpiryDate).toBe('31-12-2028');

      saleRepo.findOne.mockResolvedValue({ ...baseSale, id: 'sale-e32' });
      sequenceRepo.findOne.mockResolvedValue({ id: 'seq-e32', ncfType: 'E32', currentSequence: 1, endSequence: 1000, expiryDate: '31-12-2028' });
      const e32Invoice = await service.emitInvoice({ saleId: 'sale-e32', ncfType: 'E32' });
      expect(e32Invoice.ncfExpiryDate).toBeUndefined();
    });
  });

  describe('getReceiptMetadata — unidadMedida por ítem', () => {
    it('etiqueta hardware como UND y todo lo demás como SERV', async () => {
      invoiceRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        status: 'ISSUED',
        ncfNumber: 'E3200000001',
        ncfType: 'E32',
        issuedAt: new Date('2026-08-01'),
        sale: {
          id: 'sale-1',
          paymentMethod: 'CASH',
          subtotal: 1500,
          discountAmount: 0,
          itbisTotal: 270,
          grandTotal: 1770,
          client: { name: 'Cliente VIP', docType: 'RNC', docNumber: '131000001' },
          details: [
            { itemType: 'PLAN_SUBSCRIPTION', concept: 'Fibra 100Mbps', quantity: 1, unitPrice: 1000, itbisAmount: 180, subtotal: 1000 },
            { itemType: 'PRODUCT_HARDWARE', concept: 'Router GPON', quantity: 1, unitPrice: 500, itbisAmount: 90, subtotal: 500 },
          ],
        },
      });

      const metadata = await service.getReceiptMetadata('inv-1');
      expect(metadata.sale.details[0].unidadMedida).toBe('SERV');
      expect(metadata.sale.details[1].unidadMedida).toBe('UND');
    });
  });

  describe('settleInvoice', () => {
    it('lanza NotFoundException si la factura no existe', async () => {
      invoiceRepo.findOne.mockResolvedValue(null);

      await expect(service.settleInvoice('inv-x', {} as any, 'E32')).rejects.toThrow(NotFoundException);
    });

    it('lanza ConflictException si la factura no está PENDING_PAYMENT', async () => {
      invoiceRepo.findOne.mockResolvedValue({ id: 'inv-1', status: 'ISSUED' });

      await expect(service.settleInvoice('inv-1', {} as any, 'E32')).rejects.toThrow(ConflictException);
    });

    it('timbra y liquida una factura PENDING_PAYMENT, asignando NCF y marcándola ISSUED', async () => {
      invoiceRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        status: 'PENDING_PAYMENT',
        subtotal: 2195,
        itbisTotal: 395.1,
        cdtAmount: 43.9,
        grandTotal: 2634,
        concept: 'Combo Dúo - Septiembre 2026',
      });
      sequenceRepo.findOne.mockResolvedValue({ id: 'seq-e32', ncfType: 'E32', currentSequence: 1, endSequence: 1000 });

      const sale = {
        id: 'sale-200',
        clientId: 'client-1',
        subtotal: 2195,
        itbisTotal: 395.1,
        grandTotal: 2634,
        client: { id: 'client-1', name: 'Juan Perez', docType: 'CEDULA', docNumber: '00112223334' },
        details: [
          {
            itemType: 'PLAN_SUBSCRIPTION',
            concept: 'Combo Dúo - Septiembre 2026',
            quantity: 1,
            unitPrice: 2195,
            itbisAmount: 395.1,
            subtotal: 2195,
          },
        ],
      };

      const invoice = await service.settleInvoice('inv-1', sale as any, 'E32');

      expect(invoice.status).toBe('ISSUED');
      expect(invoice.saleId).toBe('sale-200');
      expect(invoice.ncfNumber).toBe('E3200000001');
      expect(invoice.paidAt).toBeInstanceOf(Date);
      expect(invoiceRepo.save).toHaveBeenCalled();
    });

    it('declara el CDT de la factura como impuesto adicional (código 002) en el XML e-CF', async () => {
      invoiceRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        status: 'PENDING_PAYMENT',
        subtotal: 2195,
        itbisTotal: 395.1,
        cdtAmount: 43.9,
        grandTotal: 2634,
      });
      sequenceRepo.findOne.mockResolvedValue({ id: 'seq-e32', ncfType: 'E32', currentSequence: 1, endSequence: 1000 });
      const genSpy = jest.spyOn((service as any).xmlGenerator, 'generateEcfXml');

      const sale = {
        id: 'sale-200',
        clientId: 'client-1',
        subtotal: 2195,
        itbisTotal: 395.1,
        grandTotal: 2634,
        client: { docType: 'CEDULA', docNumber: '00112223334', name: 'Juan Perez' },
        details: [
          {
            itemType: 'PLAN_SUBSCRIPTION',
            concept: 'Combo Dúo',
            quantity: 1,
            unitPrice: 2195,
            itbisAmount: 395.1,
            subtotal: 2195,
          },
        ],
      };

      await service.settleInvoice('inv-1', sale as any, 'E32');

      expect(genSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          impuestosAdicionales: [expect.objectContaining({ tipoImpuesto: '002', monto: 43.9 })],
        }),
      );
    });

    it('no incluye impuestos adicionales en el XML si la factura no tiene CDT', async () => {
      invoiceRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        status: 'PENDING_PAYMENT',
        subtotal: 1250,
        itbisTotal: 225,
        cdtAmount: 0,
        grandTotal: 1475,
      });
      sequenceRepo.findOne.mockResolvedValue({ id: 'seq-e32', ncfType: 'E32', currentSequence: 1, endSequence: 1000 });
      const genSpy = jest.spyOn((service as any).xmlGenerator, 'generateEcfXml');

      const sale = {
        id: 'sale-201',
        clientId: 'client-1',
        subtotal: 1250,
        itbisTotal: 225,
        grandTotal: 1475,
        client: { docType: 'CEDULA', docNumber: '00112223335', name: 'Ana Gomez' },
        details: [
          {
            itemType: 'PLAN_SUBSCRIPTION',
            concept: 'Fibra 50',
            quantity: 1,
            unitPrice: 1250,
            itbisAmount: 225,
            subtotal: 1250,
          },
        ],
      };

      await service.settleInvoice('inv-1', sale as any, 'E32');

      expect(genSpy).toHaveBeenCalledWith(expect.objectContaining({ impuestosAdicionales: undefined }));
    });
  });

  describe('voidInvoice', () => {
    it('lanza NotFoundException si la factura no existe', async () => {
      invoiceRepo.findOne.mockResolvedValue(null);

      await expect(service.voidInvoice('inv-x')).rejects.toThrow(NotFoundException);
    });

    it('anula una factura PENDING_PAYMENT', async () => {
      invoiceRepo.findOne.mockResolvedValue({ id: 'inv-1', status: 'PENDING_PAYMENT' });

      const result = await service.voidInvoice('inv-1');

      expect(result.status).toBe('VOIDED');
      expect(invoiceRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'VOIDED' }));
    });

    it('lanza ConflictException si la factura ya está ISSUED (requiere Nota de Crédito)', async () => {
      invoiceRepo.findOne.mockResolvedValue({ id: 'inv-1', status: 'ISSUED' });

      await expect(service.voidInvoice('inv-1')).rejects.toThrow(ConflictException);
    });

    it('lanza ConflictException si la factura ya está VOIDED', async () => {
      invoiceRepo.findOne.mockResolvedValue({ id: 'inv-1', status: 'VOIDED' });

      await expect(service.voidInvoice('inv-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('createCreditNote', () => {
    const makeIssuedInvoice = (overrides: any = {}) => ({
      id: 'inv-original',
      status: 'ISSUED',
      ncfNumber: 'E310000001701',
      issuedAt: new Date(),
      clientId: 'client-1',
      contractId: 'contract-1',
      subtotal: 1000,
      itbisTotal: 180,
      cdtAmount: 0,
      grandTotal: 1180,
      sale: {
        userId: 'user-cajero-1',
        paymentMethod: 'CASH',
        details: [
          { itemType: 'PLAN_SUBSCRIPTION', itemId: 'plan-1', concept: 'Fibra 100', quantity: 1, unitPrice: 1000, itbisAmount: 180, subtotal: 1000 },
        ],
      },
      ...overrides,
    });

    beforeEach(() => {
      sequenceRepo.findOne.mockResolvedValue({ id: 'seq-e34', ncfType: 'E34', currentSequence: 1, endSequence: 1000 });
    });

    it('lanza NotFoundException si la factura original no existe', async () => {
      invoiceRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.createCreditNote('inv-x', 'Motivo', 'user-1', [Role.ADMIN])).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza ConflictException si la factura no está ISSUED', async () => {
      invoiceRepo.findOne.mockResolvedValueOnce(makeIssuedInvoice({ status: 'PENDING_PAYMENT' }));

      await expect(
        service.createCreditNote('inv-original', 'Motivo', 'user-1', [Role.ADMIN]),
      ).rejects.toThrow(ConflictException);
    });

    it('lanza ConflictException si se intenta anular una Nota de Crédito (encadenamiento)', async () => {
      invoiceRepo.findOne.mockResolvedValueOnce(makeIssuedInvoice({ ncfType: 'E34' }));

      await expect(
        service.createCreditNote('inv-original', 'Motivo', 'user-1', [Role.ADMIN]),
      ).rejects.toThrow(ConflictException);
    });

    it('lanza ConflictException si ya existe una Nota de Crédito para esta factura', async () => {
      invoiceRepo.findOne
        .mockResolvedValueOnce(makeIssuedInvoice())
        .mockResolvedValueOnce({ id: 'credit-note-existing', ncfNumber: 'E340000000001' });

      await expect(
        service.createCreditNote('inv-original', 'Motivo', 'user-1', [Role.ADMIN]),
      ).rejects.toThrow(ConflictException);
    });

    it('CAJERO no puede anular una factura que no cobró él mismo', async () => {
      invoiceRepo.findOne
        .mockResolvedValueOnce(makeIssuedInvoice({ sale: { userId: 'otro-cajero', details: [] } }))
        .mockResolvedValueOnce(null);

      await expect(
        service.createCreditNote('inv-original', 'Motivo', 'user-cajero-1', [Role.CAJERO]),
      ).rejects.toThrow(ForbiddenException);
    });

    it('CAJERO no puede anular una factura de más de 48 horas, aunque la haya cobrado él mismo', async () => {
      const oldDate = new Date(Date.now() - 49 * 60 * 60 * 1000);
      invoiceRepo.findOne
        .mockResolvedValueOnce(makeIssuedInvoice({ issuedAt: oldDate, sale: { userId: 'user-cajero-1', details: [] } }))
        .mockResolvedValueOnce(null);

      await expect(
        service.createCreditNote('inv-original', 'Motivo', 'user-cajero-1', [Role.CAJERO]),
      ).rejects.toThrow(ConflictException);
    });

    it('CAJERO sí puede anular su propia factura dentro de las 48 horas', async () => {
      invoiceRepo.findOne.mockResolvedValueOnce(makeIssuedInvoice()).mockResolvedValueOnce(null);

      const result = await service.createCreditNote('inv-original', 'Motivo válido', 'user-cajero-1', [Role.CAJERO]);

      expect(result.ncfType).toBe('E34');
      expect(result.originalInvoiceId).toBe('inv-original');
      expect(result.ncfModificado).toBe('E310000001701');
      expect(result.grandTotal).toBe(1180);
    });

    it('ADMIN puede anular cualquier factura sin restricción de autoría/tiempo', async () => {
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      invoiceRepo.findOne
        .mockResolvedValueOnce(makeIssuedInvoice({ issuedAt: oldDate, sale: { userId: 'otro-usuario', details: [] } }))
        .mockResolvedValueOnce(null);

      const result = await service.createCreditNote('inv-original', 'Motivo', 'admin-1', [Role.ADMIN]);

      expect(result.ncfType).toBe('E34');
    });

    it('indicadorNotaCredito es "0" cuando la Nota de Crédito se emite dentro de 30 días', async () => {
      invoiceRepo.findOne.mockResolvedValueOnce(makeIssuedInvoice()).mockResolvedValueOnce(null);
      const genSpy = jest.spyOn((service as any).xmlGenerator, 'generateEcfXml');

      await service.createCreditNote('inv-original', 'Motivo', 'admin-1', [Role.ADMIN]);

      expect(genSpy).toHaveBeenCalledWith(expect.objectContaining({ indicadorNotaCredito: '0' }));
    });

    it('indicadorNotaCredito es "1" cuando la Nota de Crédito se emite después de 30 días', async () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
      invoiceRepo.findOne.mockResolvedValueOnce(makeIssuedInvoice({ issuedAt: oldDate })).mockResolvedValueOnce(null);
      const genSpy = jest.spyOn((service as any).xmlGenerator, 'generateEcfXml');

      await service.createCreditNote('inv-original', 'Motivo', 'admin-1', [Role.ADMIN]);

      expect(genSpy).toHaveBeenCalledWith(expect.objectContaining({ indicadorNotaCredito: '1' }));
    });

    it('hace rollback de la transacción si falla el envío a la DGII', async () => {
      invoiceRepo.findOne.mockResolvedValueOnce(makeIssuedInvoice()).mockResolvedValueOnce(null);
      qrSaleRepo.save.mockRejectedValueOnce(new Error('DB down'));

      await expect(service.createCreditNote('inv-original', 'Motivo', 'admin-1', [Role.ADMIN])).rejects.toThrow(
        'DB down',
      );
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.commitTransaction).not.toHaveBeenCalled();
    });
  });

  describe('generateInvoicePdf', () => {
    it('arma los metadatos del recibo y delega la generación del PDF A4 al PdfGeneratorService', async () => {
      invoiceRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        status: 'ISSUED',
        ncfNumber: 'E3200000001',
        ncfType: 'E32',
        securityCode: 'A1B2C3',
        issuedAt: new Date('2026-08-01'),
        contingencyMode: false,
        sale: {
          id: 'sale-1',
          paymentMethod: 'CASH',
          subtotal: 1000,
          discountAmount: 0,
          itbisTotal: 180,
          grandTotal: 1180,
          client: { name: 'Cliente VIP', docType: 'RNC', docNumber: '131000001', email: 'a@a.com' },
          details: [{ concept: 'Fibra 100', quantity: 1, unitPrice: 1000, itbisAmount: 180, subtotal: 1000 }],
        },
      });

      const pdfGenerator = (service as any).pdfGenerator as { generateInvoiceA4Pdf: jest.Mock };
      const buffer = await service.generateInvoicePdf('inv-1');

      expect(buffer.toString('latin1')).toContain('%PDF-1.4');
      expect(pdfGenerator.generateInvoiceA4Pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          invoice: expect.objectContaining({ ncfNumber: 'E3200000001' }),
          client: expect.objectContaining({ name: 'Cliente VIP' }),
        }),
      );
    });

    it('propaga el error si la factura está PENDING_PAYMENT (sin venta asociada)', async () => {
      invoiceRepo.findOne.mockResolvedValue({ id: 'inv-2', status: 'PENDING_PAYMENT', sale: null });

      await expect(service.generateInvoicePdf('inv-2')).rejects.toThrow(
        'está pendiente de pago y aún no tiene una venta asociada',
      );
    });
  });
});
