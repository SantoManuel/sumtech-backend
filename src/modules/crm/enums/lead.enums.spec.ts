import { LEAD_SOURCE_VALUES, LEAD_STATUS_VALUES } from './lead.enums';

describe('lead.enums', () => {
  it('LEAD_SOURCE_VALUES contiene exactamente los 5 valores esperados (incluyendo WEB_CHATBOT)', () => {
    expect(LEAD_SOURCE_VALUES).toEqual(['WEB_LANDING', 'CALL_INBOUND', 'WHATSAPP', 'FLYER', 'WEB_CHATBOT']);
  });

  it('LEAD_STATUS_VALUES contiene exactamente los 5 valores esperados', () => {
    expect(LEAD_STATUS_VALUES).toEqual(['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'DISCARDED']);
  });
});
