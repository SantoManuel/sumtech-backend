/**
 * Fuente única de verdad para los valores de `source` de una Opportunity.
 * A diferencia de estado/próxima acción/motivo de pérdida (catálogos
 * editables en `crm.subscription_statuses`/`next_actions`/`loss_reasons`),
 * el origen del prospecto es un enum fijo — no lo edita un administrador
 * desde una UI, lo determina el canal técnico por el que llegó.
 */
export const LEAD_SOURCE_VALUES = ['WEB_LANDING', 'CALL_INBOUND', 'WHATSAPP', 'FLYER', 'WEB_CHATBOT'] as const;
export type LeadSource = (typeof LEAD_SOURCE_VALUES)[number];
