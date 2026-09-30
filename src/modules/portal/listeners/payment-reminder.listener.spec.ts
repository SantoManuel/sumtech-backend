import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentReminderListener } from './payment-reminder.listener';
import { ClientNotificationEntity } from '../entities/client-notification.entity';
import { NotificationTemplateEntity } from '../entities/notification-template.entity';
import { PaymentReminderEvent } from '../../billing/events/payment-reminder.event';
import { CompanyService } from '../../company/company.service';

describe('PaymentReminderListener', () => {
  let listener: PaymentReminderListener;
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
        PaymentReminderListener,
        { provide: getRepositoryToken(ClientNotificationEntity), useValue: notificationRepo },
        { provide: getRepositoryToken(NotificationTemplateEntity), useValue: templateRepo },
        { provide: CompanyService, useValue: companyService },
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

  it('utiliza la plantilla personalizada de NotificationTemplateEntity para morosidad', async () => {
    templateRepo.findOne.mockResolvedValueOnce({
      id: 'tpl-2',
      eventType: 'PAYMENT_REMINDER_OVERDUE',
      titleTemplate: '¡Atención! Servicio en riesgo de suspensión',
      bodyTemplate: 'Tu factura de {{moneda}} {{monto}} lleva {{diasVencida}} días vencida (venció el {{fechaVencimiento}}). Realiza tu pago hoy.',
      currencySymbol: 'RD$',
      isActive: true,
    });

    const event: PaymentReminderEvent = {
      invoiceId: 'inv-99',
      clientId: 'client-1',
      contractId: 'contract-1',
      concept: 'Plan Dúo',
      grandTotal: 1500,
      dueDate: '2026-09-10',
      kind: 'OVERDUE',
      daysOverdue: 6,
      occurredOn: new Date(),
    };

    await listener.handlePaymentReminderDue(event);

    const created = notificationRepo.create.mock.calls[0][0];
    expect(created.title).toBe('¡Atención! Servicio en riesgo de suspensión');
    expect(created.message).toContain('RD$ 1,500');
    expect(created.message).toContain('6 días vencida');
    expect(created.message).toContain('2026-09-10');
  });

  it('deriva el símbolo de moneda de CompanyProfileEntity.currency cuando la plantilla no lo especifica', async () => {
    companyService.getProfile.mockResolvedValueOnce({ currency: 'USD' });

    const event: PaymentReminderEvent = {
      invoiceId: 'inv-1',
      clientId: 'client-1',
      contractId: 'contract-1',
      concept: 'Fibra 100 Mbps',
      grandTotal: 50,
      dueDate: '2026-09-15',
      kind: 'ADVANCE',
      occurredOn: new Date(),
    };

    await listener.handlePaymentReminderDue(event);

    const created = notificationRepo.create.mock.calls[0][0];
    expect(created.message).toContain('$ 50');
    expect(created.message).not.toContain('RD$');
  });

  it('una plantilla con currencySymbol explícito sigue ganando sobre la moneda de la empresa', async () => {
    companyService.getProfile.mockResolvedValueOnce({ currency: 'USD' });
    templateRepo.findOne.mockResolvedValueOnce({
      id: 'tpl-3',
      eventType: 'PAYMENT_REMINDER_DUE',
      titleTemplate: 'Recordatorio',
      bodyTemplate: 'Debes {{moneda}} {{monto}}.',
      currencySymbol: 'EUR€',
      isActive: true,
    });

    const event: PaymentReminderEvent = {
      invoiceId: 'inv-1',
      clientId: 'client-1',
      contractId: 'contract-1',
      concept: 'Fibra 100 Mbps',
      grandTotal: 50,
      dueDate: '2026-09-15',
      kind: 'ADVANCE',
      occurredOn: new Date(),
    };

    await listener.handlePaymentReminderDue(event);

    const created = notificationRepo.create.mock.calls[0][0];
    expect(created.message).toContain('EUR€ 50');
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
