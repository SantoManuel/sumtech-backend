-- ==============================================================================
-- MIGRACIÓN 035: Nuevo valor de enum para leads originados en el chatbot web
-- El widget de chat público del landing (sumtech_landingPage_TeleAzua) crea
-- leads automáticamente vía Chatbot_sumtech. Necesitan distinguirse de
-- WEB_LANDING (formulario estático) para que CRM sepa que ya hubo una
-- conversación previa con el prospecto.
-- Esquema: crm.leads
-- ==============================================================================

ALTER TYPE "crm"."leads_source_enum" ADD VALUE IF NOT EXISTS 'WEB_CHATBOT';
