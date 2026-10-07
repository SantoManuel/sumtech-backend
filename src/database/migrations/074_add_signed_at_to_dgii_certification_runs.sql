-- =============================================================================
-- MIGRACIÓN 074: instante real de la firma en dgii_certification_runs
-- =============================================================================
-- POR QUÉ ESTA COLUMNA:
--
-- El QR oficial de la DGII exige el parámetro `fechafirma` = la hora en que se
-- firmó digitalmente el e-CF. Hasta ahora la Representación Impresa tomaba ese
-- valor de `executed_at`, que es un @CreateDateColumn: el reloj de PostgreSQL en
-- el momento del INSERT, es decir DESPUÉS del round-trip con la DGII
-- (firmar -> enviar -> esperar respuesta -> guardar). En la corrida real de
-- E330000000161 eso produjo un desfase de 2 segundos:
--
--   DGII (correcto):  ...&fechafirma=02-10-2026%2022%3A26%3A44&...
--   QR impreso:       ...&fechafirma=02-10-2026%2022%3A26%3A46&...
--
-- Con reintentos o una DGII lenta el desfase crece a minutos y el portal
-- `certecf/consultatimbre` puede rechazar la consulta por incompatibilidad de
-- parámetros.
--
-- `signed_at` guarda el instante capturado inmediatamente después de
-- `signerService.signXml(...)` en DgiiClientService.submitEcf, que es la firma
-- que efectivamente viaja a la DGII y de la que se deriva el codigoseguridad.
-- `executed_at` se conserva intacto: sigue siendo la bitácora de cuándo se
-- registró la corrida (y otros flujos la ordenan para obtener "el último
-- estado conocido" de un e-NCF).
--
-- NULL es esperado y correcto: las corridas que nunca llegaron a firmar
-- (rechazo XSD previo, error de red, caso bloqueado) no tienen firma que
-- registrar. El consumidor del QR usa `signed_at ?? executed_at` como
-- respaldo, de modo que las filas anteriores a esta migración siguen
-- imprimiendo una URL válida.
-- =============================================================================

ALTER TABLE "public"."dgii_certification_runs"
  ADD COLUMN IF NOT EXISTS "signed_at" TIMESTAMP WITH TIME ZONE NULL;

COMMENT ON COLUMN "public"."dgii_certification_runs"."signed_at" IS
  'Instante de la firma digital XMLDSig (parametro fechafirma del QR DGII). NULL si la corrida nunca se firmo.';