-- ==============================================================================
-- MIGRACIÓN 077: Entrada genérica EPON en net.onu_types
-- ==============================================================================
--
-- POR QUÉ: el catálogo onu_types solo tenía modelos GPON (ZTE/Huawei/VSOL).
-- Al implementar authorizeOnu() real para HiOSO (OLT EPON) se confirmó que
-- "add onu <id> <mac> <type>" exige un ONU-TYPE real del firmware, pero a
-- diferencia de GPON (donde el tipo suele ser vendor-lock, ej. "ZTE-F660"),
-- en una OLT EPON como esta se puede conectar cualquier ONU EPON de
-- cualquier marca — "onu-01g" no es un nombre comercial, es el único valor
-- de ONU-TYPE que el propio firmware mostró como ejemplo (ver
-- test/fixtures/hioso/cli_command_tree.txt nota 12), muy probablemente una
-- clase de capacidad (ej. "1 puerto GE") y no un modelo de marca.
--
-- Por eso esta entrada es "Genérico", no "HiOSO": el campo que sí importa
-- para filtrar el selector de la UI es pon_type='EPON', no vendor.
-- ==============================================================================

-- Nota: no se usa ON CONFLICT (vendor, model) porque en producción la tabla
-- net.onu_types (creada por la migración 064) nunca tuvo esa restricción
-- UNIQUE realmente aplicada (drift de esquema preexistente, no de esta
-- migración) — "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification". Se usa WHERE NOT EXISTS, que es idempotente sin
-- depender de ninguna restricción de la tabla.
INSERT INTO net.onu_types (vendor, model, vendor_type_name, pon_type, eth_ports, pots_ports, wifi_bands, catv_port, supports_tr069, supports_omci, supports_bridge, supports_router, default_mode)
SELECT 'Genérico', 'ONU EPON (4 puertos)', 'onu-01g', 'EPON', 4, 0, 'Variable según fabricante', FALSE, TRUE, TRUE, TRUE, TRUE, 'ROUTER'
WHERE NOT EXISTS (
  SELECT 1 FROM net.onu_types WHERE vendor = 'Genérico' AND model = 'ONU EPON (4 puertos)'
);
