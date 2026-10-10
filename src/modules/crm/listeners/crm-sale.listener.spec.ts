import { Test, TestingModule } from '@nestjs/testing';
import { CrmSaleListener } from './crm-sale.listener';
import { CrmService } from '../crm.service';
import { SaleConfirmedEvent } from '../../pos/events/sale-confirmed.event';

describe('CrmSaleListener', () => {
  let listener: CrmSaleListener;
  let crmService: any;

  beforeEach(async () => {
    crmService = {
      recordSaleInteraction: jest.fn().mockResolvedValue({ id: 'interaction-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CrmSaleListener, { provide: CrmService, useValue: crmService }],
    }).compile();

    listener = module.get<CrmSaleListener>(CrmSaleListener);
  });

  it('pasa el userId real del evento a recordSaleInteraction (bug: antes se omitía y caía al placeholder que viola la FK de sec.users)', async () => {
    const event: SaleConfirmedEvent = {
      saleId: 'sale-1',
      clientId: 'client-1',
      userId: 'user-admin-1',
      planIds: [],
      ncfNumber: 'E320000000001',
      grandTotal: 1180,
      occurredOn: new Date(),
    };

    await listener.handleSaleConfirmed(event);

    expect(crmService.recordSaleInteraction).toHaveBeenCalledWith(
      'client-1',
      'E320000000001',
      1180,
      'user-admin-1',
    );
  });

  it('no propaga el error si recordSaleInteraction falla (el listener no debe tumbar el flujo de ventas)', async () => {
    crmService.recordSaleInteraction.mockRejectedValue(new Error('DB caída'));

    const event: SaleConfirmedEvent = {
      saleId: 'sale-1',
      clientId: 'client-1',
      userId: 'user-admin-1',
      planIds: [],
      ncfNumber: 'E320000000001',
      grandTotal: 1180,
      occurredOn: new Date(),
    };

    await expect(listener.handleSaleConfirmed(event)).resolves.toBeUndefined();
  });
});
