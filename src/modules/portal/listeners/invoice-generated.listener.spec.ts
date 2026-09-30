import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InvoiceGeneratedListener } from './invoice-generated.listener';
import { ClientNotificationEntity } from '../entities/client-notification.entity';
import { NotificationTemplateEntity } from '../entities/notification-template.entity';
import { InvoiceGeneratedEvent } from '../../billing/events/invoice-generated.event';
import { CompanyService } from '../../company/company.service';

describe('InvoiceGeneratedListener', () => {
  let listener: InvoiceGeneratedListener;
  let notificationRepo: any;
  let templateRepo: any;
  let companyService: any;

  beforeEach(async () => {
    notificationRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'notif-1' })),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    templateRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    companyService = {
      getProfile: jest.fn().mockResolvedValue({ currency: 'DOP' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceGeneratedListener,
        { provide: getRepositoryToken(ClientNotificationEntity), useValue: notificationRepo },
        { provide: getRepositoryToken(NotificationTemplateEntity), useValue: templateRepo },
        { provide: CompanyService, useValue: companyService },
      ],
    }).compile();

    listener = module.get<InvoiceGeneratedListener>(InvoiceGeneratedListener);
  });

  it('debe estar definido', () => {
    expect(listener).toBeDefined();
  });

  it('crea una notificación INVOICE_GENERATED con el monto y la fecha límite del evento', async () => {
    const event: InvoiceGeneratedEvent = {
      invoiceId: 'inv-1',
      clientId: 'client-1',
      contractId: 'contract-1',
      concept: 'Fibra 100 Mbps - Servicio de septiembre de 2026',
      grandTotal: 2400,
      dueDate: '2026-09-15',
      occurredOn: new Date(),
    };

    await listener.handleInvoiceGenerated(event);

    expect(notificationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        type: 'INVOICE_GENERATED',
        link: '/portal/facturas',
      }),
    );
    const savedArg = notificationRepo.create.mock.calls[0][0];
    expect(savedArg.message).toContain('2,400');
    expect(savedArg.message).toContain('2026-09-15');
  });

  it('utiliza la plantilla personalizada de NotificationTemplateEntity cuando existe', async () => {
    templateRepo.findOne.mockResolvedValueOnce({
      id: 'tpl-1',
      eventType: 'INVOICE_GENERATED',
      titleTemplate: 'Tu factura de {{moneda}} {{monto}} está lista',
      bodyTemplate: 'Hola! Tu servicio de {{concepto}} ha emitido la factura {{facturaId}} por {{moneda}} {{monto}}. Paga antes del {{fechaVencimiento}}.',
      currencySymbol: 'USD$',
      isActive: true,
    });

    const event: InvoiceGeneratedEvent = {
      invoiceId: 'INV-2026-99',
      clientId: 'client-1',
      contractId: 'contract-1',
      concept: 'Fibra 300 Megas Simétricos',
      grandTotal: 1800,
      dueDate: '2026-10-05',
      occurredOn: new Date(),
    };

    await listener.handleInvoiceGenerated(event);

    const savedArg = notificationRepo.create.mock.calls[0][0];
    expect(savedArg.title).toBe('Tu factura de USD$ 1,800 está lista');
    expect(savedArg.message).toContain('Fibra 300 Megas Simétricos');
    expect(savedArg.message).toContain('USD$ 1,800');
    expect(savedArg.message).toContain('2026-10-05');
  });

  it('deriva el símbolo de moneda de CompanyProfileEntity.currency cuando no hay plantilla', async () => {
    companyService.getProfile.mockResolvedValueOnce({ currency: 'USD' });

    const event: InvoiceGeneratedEvent = {
      invoiceId: 'inv-1',
      clientId: 'client-1',
      contractId: 'contract-1',
      concept: 'Fibra 100 Mbps',
      grandTotal: 50,
      dueDate: '2026-09-15',
      occurredOn: new Date(),
    };

    await listener.handleInvoiceGenerated(event);

    const savedArg = notificationRepo.create.mock.calls[0][0];
    expect(savedArg.message).toContain('$ 50');
    expect(savedArg.message).not.toContain('RD$');
  });

  it('no propaga el error si falla la creación de la notificación (no debe romper el flujo de facturación)', async () => {
    notificationRepo.save.mockRejectedValueOnce(new Error('DB down'));
    const event: InvoiceGeneratedEvent = {
      invoiceId: 'inv-1',
      clientId: 'client-1',
      contractId: 'contract-1',
      concept: 'Fibra 100 Mbps',
      grandTotal: 2400,
      dueDate: '2026-09-15',
      occurredOn: new Date(),
    };

    await expect(listener.handleInvoiceGenerated(event)).resolves.not.toThrow();
  });
});
