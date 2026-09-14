/**
 * Fuente única de verdad para los valores de `source`/`status` de un Lead.
 * Antes estaban repetidos como literales sueltos en `LeadEntity`, `CreateLeadDto`
 * y `RequestLeadDto` — un cambio (como agregar WEB_CHATBOT) requería tocar los
 * 3 lugares a mano y podía desincronizarse. Se centraliza aquí.
 */
export const LEAD_SOURCE_VALUES = ['WEB_LANDING', 'CALL_INBOUND', 'WHATSAPP', 'FLYER', 'WEB_CHATBOT'] as const;
export type LeadSource = (typeof LEAD_SOURCE_VALUES)[number];

export const LEAD_STATUS_VALUES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'DISCARDED'] as const;
export type LeadStatus = (typeof LEAD_STATUS_VALUES)[number];
