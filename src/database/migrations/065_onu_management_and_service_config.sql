-- Migración 065: Ciclo de vida y provisión de ONUs/ONTs (Fase 4 - Nivel 4)
-- Requisitos cubiertos: RF-OLT-014, RF-OLT-015, RF-OLT-016, RF-OLT-017, RF-OLT-018, RF-ONU-001 a RF-ONU-007

-- 1. Registro de ONUs detectadas y autorizadas (RF-OLT-014/015/016)
CREATE TABLE IF NOT EXISTS net.onus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  olt_id UUID NOT NULL REFERENCES net.olts(id) ON DELETE CASCADE,
  pon_interface_id UUID REFERENCES net.olt_interfaces(id) ON DELETE SET NULL,
  onu_index VARCHAR(20) NOT NULL, -- ej. '1/1/1:1' o '1'
  serial_number VARCHAR(50) NOT NULL,
  mac VARCHAR(50) NULL,
  vendor VARCHAR(50) NULL,
  model VARCHAR(50) NULL,
  onu_type_id UUID REFERENCES net.onu_types(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'UNCONFIGURED', -- 'UNCONFIGURED' | 'AUTHORIZING' | 'ACTIVE' | 'BLOCKED' | 'OFFLINE' | 'LOS' | 'ERROR'
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  detected_by VARCHAR(30) DEFAULT 'OLT_POLL', -- 'OLT_POLL' | 'ACS_INFORM'
  authorized_at TIMESTAMPTZ NULL,
  authorized_by_user_id UUID NULL,
  rx_power_dbm NUMERIC(5,2) NULL,
  tx_power_dbm NUMERIC(5,2) NULL,
  last_seen_at TIMESTAMPTZ NULL,
  serial_number_id UUID NULL,
  genieacs_device_id VARCHAR(100) NULL,
  contract_id UUID NULL REFERENCES com.contracts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(olt_id, serial_number)
);

-- 2. Configuración de servicio detallada de la ONU (RF-OLT-018 / RF-ONU-001..007)
CREATE TABLE IF NOT EXISTS net.onu_service_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onu_id UUID NOT NULL REFERENCES net.onus(id) ON DELETE CASCADE,
  management_method VARCHAR(20) NOT NULL DEFAULT 'TR069', -- 'OMCI' | 'TR069'
  operation_mode VARCHAR(20) NOT NULL DEFAULT 'ROUTER', -- 'BRIDGE' | 'ROUTER'
  service_vlan_id UUID REFERENCES net.vlans(id) ON DELETE RESTRICT,
  mgmt_vlan_id UUID REFERENCES net.vlans(id) ON DELETE SET NULL,
  tr069_vlan_id UUID REFERENCES net.vlans(id) ON DELETE SET NULL,
  tr069_network_id UUID REFERENCES net.tr069_networks(id) ON DELETE SET NULL,
  tr069_ip VARCHAR(45) NULL,
  ip_protocol VARCHAR(20) DEFAULT 'IPV4', -- 'IPV4' | 'IPV6' | 'DUAL'
  wan_mode VARCHAR(20) DEFAULT 'PPPOE', -- 'STATIC' | 'DHCP' | 'PPPOE'
  wan_static_ip VARCHAR(45) NULL,
  wan_static_mask VARCHAR(45) NULL,
  wan_static_gw VARCHAR(45) NULL,
  pppoe_from_access BOOLEAN DEFAULT TRUE,
  speed_profile_id UUID REFERENCES net.olt_speed_profiles(id) ON DELETE SET NULL,
  desired_version INT DEFAULT 1,
  applied_version INT DEFAULT 0,
  apply_status VARCHAR(30) DEFAULT 'PENDING', -- 'APPLIED' | 'PENDING' | 'ERROR'
  last_apply_error TEXT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(onu_id)
);
