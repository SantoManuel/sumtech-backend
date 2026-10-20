-- ==============================================================================
-- MIGRACIÓN 093: Estado REAL del push a GenieACS (net.onu_service_config)
-- ==============================================================================
--
-- POR QUÉ: "apply_status" ya existe en esta tabla, pero es del lado OLT --
-- se pone en 'APPLIED' SIEMPRE que authorizeOnu()/reprovisionOnu() terminan,
-- sin importar si CpeConfiguratorService.configureCpe() (el push real de
-- WAN/PPPoE/WiFi/tags al CPE vía GenieACS) tuvo éxito o no. Confirmado en
-- vivo (2026-10-20, ONU CMDCDD4D131E): ese push falla casi siempre en el
-- primer intento (el equipo recién autorizado todavía no le reportó nada a
-- GenieACS) y hasta hoy no quedaba NINGUNA señal persistida de "esto quedó
-- pendiente" -- el único reintento era manual (botón "Reprovisionar").
--
-- Estas 3 columnas, separadas de "apply_status" a propósito (no se
-- mezclan dos conceptos distintos en un solo campo), permiten que un job
-- periódico encuentre exactamente qué ONUs TR-069 todavía no confirmaron el
-- push y lo reintente solo (ver OnuCpeSyncReconciliationService).
-- ==============================================================================

ALTER TABLE "net"."onu_service_config"
  ADD COLUMN IF NOT EXISTS "cpe_config_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "last_cpe_config_error" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "cpe_config_synced_at" TIMESTAMPTZ NULL;

COMMENT ON COLUMN "net"."onu_service_config"."cpe_config_status" IS
  'Estado del push a GenieACS (CpeConfiguratorService.configureCpe): PENDING | APPLIED | ERROR. Distinto de "apply_status", que es del lado OLT y se pone en APPLIED sin importar GenieACS.';
COMMENT ON COLUMN "net"."onu_service_config"."last_cpe_config_error" IS
  'Último mensaje de error del push a GenieACS, si cpe_config_status = ERROR.';
COMMENT ON COLUMN "net"."onu_service_config"."cpe_config_synced_at" IS
  'Fecha/hora del último push a GenieACS confirmado con éxito (cpe_config_status pasó a APPLIED).';
