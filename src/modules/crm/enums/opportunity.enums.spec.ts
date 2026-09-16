import { LEAD_SOURCE_VALUES } from './opportunity.enums';

describe('opportunity.enums', () => {
  it('LEAD_SOURCE_VALUES contiene exactamente los 5 valores esperados (incluyendo WEB_CHATBOT)', () => {
    expect(LEAD_SOURCE_VALUES).toEqual(['WEB_LANDING', 'CALL_INBOUND', 'WHATSAPP', 'FLYER', 'WEB_CHATBOT']);
  });
});
