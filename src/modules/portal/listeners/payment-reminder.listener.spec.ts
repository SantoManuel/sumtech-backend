import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentReminderListener } from './payment-reminder.listener';
import { ClientNotificationEntity } from '../entities/client-notification.entity';
import { PaymentReminderEvent } from '../../billing/events/payment-reminder.event';

describe('PaymentReminderListener', () => {
  let listener: PaymentReminderListener;
  let notificationRepo: any;

  beforeEach(async () => {
    notificationRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'notif-1' })),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentReminderListener,
        { provide: getRepositoryToken(ClientNotificationEntity), useValue: notificationRepo },
      ],
    }).compile();

    listener = module.get<PaymentReminderListener>(PaymentReminderListener);
  });

  it('debe estar definido', () => {
    expect(listener).toBeDefined();
  });

  it('crea un recordatorio preventivo con título distinto al de vencida cuando kind=ADVANCE', async () => {
    const event: PaymentReminderEvent = {
      invoiceId: 'inv-1',
      clientId: 'client-1',
      contractId: 'contract-1',
      concept: 'Fibra 100 Mbps',
      grandTotal: 2400,
      dueDate: '2026-09-15',
      kind: 'ADVANCE',
      occurredOn: new Date(),
    };

    await listener.handlePaymentReminderDue(event);

    const created = notificationRepo.create.mock.calls[0][0];
    expect(created.type).toBe('PAYMENT_REMINDER');
    expect(created.title).toBe('Recordatorio de Pago');
    expect(created.message).toContain('2,400');
    expect(created.message).not.toContain('vencida');
  });

  it('crea un recordatorio de vencida con los días de mora cuando kind=OVERDUE', async () => {
    const event: PaymentReminderEvent = {
      invoiceId: 'inv-1',
      clientId: 'client-1',
      contractId: 'contract-1',
      concept: 'Fibra 100 Mbps',
      grandTotal: 2400,
      dueDate: '2026-09-15',
      kind: 'OVERDUE',
      daysOverdue: 4,
      occurredOn: new Date(),
    };

    await listener.handlePaymentReminderDue(event);

    const created = notificationRepo.create.mock.calls[0][0];
    expect(created.title).toBe('Factura Vencida');
    expect(created.message).toContain('4 día');
  });

  it('no propaga el error si falla la creación de la notificación', async () => {
    notificationRepo.save.mockRejectedValueOnce(new Error('DB down'));
    const event: PaymentReminderEvent = {
      invoiceId: 'inv-1',
      clientId: 'client-1',
      concept: 'Fibra 100 Mbps',
      grandTotal: 2400,
      dueDate: '2026-09-15',
      kind: 'ADVANCE',
      occurredOn: new Date(),
    };

    await expect(listener.handlePaymentReminderDue(event)).resolves.not.toThrow();
  });
});
