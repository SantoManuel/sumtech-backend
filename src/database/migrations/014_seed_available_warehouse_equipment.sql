-- ============================================================================
-- MIGRACIÓN 014: Sembrado de Equipos Serializados Disponibles en Almacenes
-- ============================================================================

DO $$
DECLARE
    v_wh_central UUID;
    v_wh_santiago UUID;
    v_prod_huawei UUID;
    v_prod_zte UUID;
    v_prod_stb UUID;
    v_admin_user UUID;
    v_serial_id UUID;
BEGIN
    -- 1. Obtener IDs de Almacenes
    SELECT id INTO v_wh_central FROM inv.warehouses WHERE name ILIKE '%Almacén Central%' LIMIT 1;
    SELECT id INTO v_wh_santiago FROM inv.warehouses WHERE name ILIKE '%Santiago%' LIMIT 1;
    IF v_wh_central IS NULL THEN
        SELECT id INTO v_wh_central FROM inv.warehouses ORDER BY created_at ASC LIMIT 1;
    END IF;

    -- 2. Obtener IDs de Productos Serializados
    SELECT id INTO v_prod_huawei FROM inv.products WHERE sku = 'HW-ONU-AC1200' LIMIT 1;
    SELECT id INTO v_prod_zte FROM inv.products WHERE sku = 'HW-ONU-ZTE-F670L' LIMIT 1;
    SELECT id INTO v_prod_stb FROM inv.products WHERE sku = 'STB-4K-ANDR' LIMIT 1;

    -- 3. Obtener Usuario Administrador
    SELECT id INTO v_admin_user FROM sec.users WHERE username = 'admin' LIMIT 1;

    -- 4. Insertar Equipos en Almacén Central
    IF v_wh_central IS NOT NULL AND v_prod_huawei IS NOT NULL THEN
        -- Huawei ONT 1
        IF NOT EXISTS (SELECT 1 FROM inv.serial_numbers WHERE serial_number = 'HWTC-WH-00101') THEN
            INSERT INTO inv.serial_numbers (id, product_id, serial_number, mac_address, status, location_type, condition, current_warehouse_id, last_movement_at)
            VALUES (gen_random_uuid(), v_prod_huawei, 'HWTC-WH-00101', 'A4:93:3F:88:10:01', 'AVAILABLE', 'WAREHOUSE', 'NEW', v_wh_central, NOW())
            RETURNING id INTO v_serial_id;

            IF v_admin_user IS NOT NULL THEN
                INSERT INTO inv.equipment_movements (id, equipment_item_id, movement_type, to_location_type, to_warehouse_id, condition_after, performed_by_user_id, notes, created_at)
                VALUES (gen_random_uuid(), v_serial_id, 'INGRESO_ALMACEN', 'WAREHOUSE', v_wh_central, 'NEW', v_admin_user, 'Ingreso inicial a Almacén Central', NOW());
            END IF;
        END IF;

        -- Huawei ONT 2
        IF NOT EXISTS (SELECT 1 FROM inv.serial_numbers WHERE serial_number = 'HWTC-WH-00102') THEN
            INSERT INTO inv.serial_numbers (id, product_id, serial_number, mac_address, status, location_type, condition, current_warehouse_id, last_movement_at)
            VALUES (gen_random_uuid(), v_prod_huawei, 'HWTC-WH-00102', 'A4:93:3F:88:10:02', 'AVAILABLE', 'WAREHOUSE', 'NEW', v_wh_central, NOW())
            RETURNING id INTO v_serial_id;

            IF v_admin_user IS NOT NULL THEN
                INSERT INTO inv.equipment_movements (id, equipment_item_id, movement_type, to_location_type, to_warehouse_id, condition_after, performed_by_user_id, notes, created_at)
                VALUES (gen_random_uuid(), v_serial_id, 'INGRESO_ALMACEN', 'WAREHOUSE', v_wh_central, 'NEW', v_admin_user, 'Ingreso inicial a Almacén Central', NOW());
            END IF;
        END IF;
    END IF;

    -- ZTE ONT
    IF v_wh_central IS NOT NULL AND v_prod_zte IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM inv.serial_numbers WHERE serial_number = 'ZTE-WH-00201') THEN
            INSERT INTO inv.serial_numbers (id, product_id, serial_number, mac_address, status, location_type, condition, current_warehouse_id, last_movement_at)
            VALUES (gen_random_uuid(), v_prod_zte, 'ZTE-WH-00201', 'C8:5B:76:99:20:01', 'AVAILABLE', 'WAREHOUSE', 'NEW', v_wh_central, NOW())
            RETURNING id INTO v_serial_id;

            IF v_admin_user IS NOT NULL THEN
                INSERT INTO inv.equipment_movements (id, equipment_item_id, movement_type, to_location_type, to_warehouse_id, condition_after, performed_by_user_id, notes, created_at)
                VALUES (gen_random_uuid(), v_serial_id, 'INGRESO_ALMACEN', 'WAREHOUSE', v_wh_central, 'NEW', v_admin_user, 'Ingreso inicial a Almacén Central', NOW());
            END IF;
        END IF;
    END IF;

    -- Decodificador STB 4K
    IF v_wh_central IS NOT NULL AND v_prod_stb IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM inv.serial_numbers WHERE serial_number = 'STB-WH-00301') THEN
            INSERT INTO inv.serial_numbers (id, product_id, serial_number, mac_address, status, location_type, condition, current_warehouse_id, last_movement_at)
            VALUES (gen_random_uuid(), v_prod_stb, 'STB-WH-00301', 'C8:5B:76:77:30:01', 'AVAILABLE', 'WAREHOUSE', 'NEW', v_wh_central, NOW())
            RETURNING id INTO v_serial_id;

            IF v_admin_user IS NOT NULL THEN
                INSERT INTO inv.equipment_movements (id, equipment_item_id, movement_type, to_location_type, to_warehouse_id, condition_after, performed_by_user_id, notes, created_at)
                VALUES (gen_random_uuid(), v_serial_id, 'INGRESO_ALMACEN', 'WAREHOUSE', v_wh_central, 'NEW', v_admin_user, 'Ingreso inicial a Almacén Central', NOW());
            END IF;
        END IF;
    END IF;

    -- Equipos en Almacén Santiago (si existe)
    IF v_wh_santiago IS NOT NULL AND v_prod_huawei IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM inv.serial_numbers WHERE serial_number = 'HWTC-STG-001') THEN
            INSERT INTO inv.serial_numbers (id, product_id, serial_number, mac_address, status, location_type, condition, current_warehouse_id, last_movement_at)
            VALUES (gen_random_uuid(), v_prod_huawei, 'HWTC-STG-001', 'A4:93:3F:55:01:01', 'AVAILABLE', 'WAREHOUSE', 'NEW', v_wh_santiago, NOW());
        END IF;
    END IF;

END $$;
