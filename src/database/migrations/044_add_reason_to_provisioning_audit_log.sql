-- ==============================================================================
-- MIGRACIÓN 044: motivo de negocio en net.provisioning_audit_log (Fase 08)
-- Hasta ahora la auditoría de red registraba QUÉ pasó (action/result) pero no
-- POR QUÉ, en términos de negocio: una SUSPEND por morosidad y una SUSPEND
-- manual por un administrador quedaban indistinguibles en el registro. Esta
-- columna guarda ese motivo, propagado desde el evento de contrato que la
-- disparó (ContractSuspendedEvent/ContractReactivatedEvent/
-- ContractTerminatedEvent), texto libre y nullable porque SYNC_PROFILE/
-- SHADOW_CHECK/CREATE no vienen de una transición de estado comercial.
-- Rollback manual:
--   ALTER TABLE "net"."provisioning_audit_log" DROP COLUMN IF EXISTS "reason";
-- ==============================================================================

ALTER TABLE "net"."provisioning_audit_log" ADD COLUMN IF NOT EXISTS "reason" TEXT;
