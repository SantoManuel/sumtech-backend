-- ==============================================================================
-- MIGRACIÓN 035: Nuevo valor de enum para leads originados en el chatbot web
-- El widget de chat público del landing (sumtech_landingPage_TeleAzua) crea
-- leads automáticamente vía Chatbot_sumtech. Necesitan distinguirse de
-- WEB_LANDING (formulario estático) para que CRM sepa que ya hubo una
-- conversación previa con el prospecto.
-- Esquema: crm.leads
-- ==============================================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t 
    JOIN pg_namespace n ON n.oid = t.typnamespace 
    WHERE n.nspname = 'crm' AND t.typname = 'leads_source_enum'
  ) THEN
    ALTER TYPE "crm"."leads_source_enum" ADD VALUE IF NOT EXISTS 'WEB_CHATBOT';
  END IF;
END $$;
