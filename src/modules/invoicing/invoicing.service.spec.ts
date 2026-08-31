import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InvoicingService } from './invoicing.service';
import { InvoiceEntity } from './entities/invoice.entity';
import { EcfSequenceEntity } from './entities/ecf-sequence.entity';
import { SaleEntity } from '../pos/entities/sale.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { ProductEntity } from '../inventory/entities/product.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { ClientEntity } from '../clients/entities/client.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { PlanEntity } from '../plans/entities/plan.entity';
import { DgiiXmlGeneratorService } from './dgii/dgii-xml-generator.service';
import { DgiiClientService } from './dgii/dgii-client.service';
import { DgiiSignerService } from './dgii/dgii-signer.service';

describe('InvoicingService', () => {
  let service: InvoicingService;
  let sequenceRepo: any;
  let invoiceRepo: any;
  let saleRepo: any;

  beforeEach(async () => {
    sequenceRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto) => ({ ...dto, id: 'seq-1' })),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    invoiceRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto) => ({ ...dto, id: 'inv-1' })),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    saleRepo = {
      findOne: jest.fn(),
    };

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
    });

    const ncf = await service.getNextNcfSequence('E31');
    expect(ncf).toBe('E3100000005');
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
});
