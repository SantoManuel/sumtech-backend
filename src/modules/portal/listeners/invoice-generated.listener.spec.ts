import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InvoiceGeneratedListener } from './invoice-generated.listener';
import { ClientNotificationEntity } from '../entities/client-notification.entity';
import { InvoiceGeneratedEvent } from '../../billing/events/invoice-generated.event';

describe('InvoiceGeneratedListener', () => {
  let listener: InvoiceGeneratedListener;
  let notificationRepo: any;

  beforeEach(async () => {
    notificationRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'notif-1' })),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceGeneratedListener,
        { provide: getRepositoryToken(ClientNotificationEntity), useValue: notificationRepo },
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
