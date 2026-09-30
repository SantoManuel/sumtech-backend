import { Test, TestingModule } from '@nestjs/testing';
import { BillingReactivationListener } from './billing-reactivation.listener';
import { MorosidadService } from '../morosidad.service';
import { InvoicePaidEvent } from '../events/invoice-paid.event';

describe('BillingReactivationListener', () => {
  let listener: BillingReactivationListener;
  let morosidadService: { reactivateIfSettled: jest.Mock };

  beforeEach(async () => {
    morosidadService = {
      reactivateIfSettled: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingReactivationListener,
        { provide: MorosidadService, useValue: morosidadService },
      ],
    }).compile();

    listener = module.get<BillingReactivationListener>(BillingReactivationListener);
  });

  it('debe estar definido', () => {
    expect(listener).toBeDefined();
  });

  it('invoca reactivateIfSettled cuando el evento contiene contractId', async () => {
    const event: InvoicePaidEvent = {
      invoiceId: 'inv-100',
      contractId: 'contract-55',
      clientId: 'client-1',
      amount: 1500,
      paidAt: new Date(),
      occurredOn: new Date(),
    };

    await listener.handleInvoicePaid(event);

    expect(morosidadService.reactivateIfSettled).toHaveBeenCalledWith('contract-55');
  });

  it('no invoca reactivateIfSettled si el evento no tiene contractId', async () => {
    const event: InvoicePaidEvent = {
      invoiceId: 'inv-200',
      clientId: 'client-1',
      amount: 500,
      paidAt: new Date(),
      occurredOn: new Date(),
    };

    await listener.handleInvoicePaid(event);

    expect(morosidadService.reactivateIfSettled).not.toHaveBeenCalled();
  });
});
