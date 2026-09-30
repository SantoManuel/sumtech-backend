-- Migración 064: OLT Core, interfaces, VLANs, perfiles de velocidad y tipos de ONU (Fase 3 - Nivel 3)
-- Requisitos cubiertos: RF-OLT-001, RF-OLT-002, RF-OLT-003, RF-OLT-004, RF-OLT-006, RF-OLT-007, RF-OLT-008, RF-OLT-010, RF-OLT-011, RF-OLT-012, RF-OLT-013

-- 1. Registro principal de OLTs (RF-OLT-001/002)
CREATE TABLE IF NOT EXISTS net.olts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  vendor VARCHAR(50) NOT NULL DEFAULT 'ZTE',
  model VARCHAR(50) NOT NULL DEFAULT 'C320',
  host VARCHAR(255) NOT NULL,
  port INT NOT NULL DEFAULT 23,
  api_protocol VARCHAR(50) NOT NULL DEFAULT 'TELNET',
  username VARCHAR(100) NOT NULL,
  password_enc TEXT NOT NULL,
  enable_password_enc TEXT NULL,
  connection_method VARCHAR(50) NOT NULL DEFAULT 'VIA_MIKROTIK',
  via_node_id UUID REFERENCES net.network_nodes(id) ON DELETE SET NULL,
  nat_port INT NULL,
  zone_id UUID REFERENCES net.zones(id) ON DELETE SET NULL,
  timezone VARCHAR(50) DEFAULT 'America/Santo_Domingo',
  language VARCHAR(10) DEFAULT 'es',
  mgmt_vlan_id INT NULL,
  status VARCHAR(50) DEFAULT 'ACTIVO',
  connection_status VARCHAR(50) DEFAULT 'DESCONECTADO',
  last_checked_at TIMESTAMPTZ NULL,
  last_successful_connection_at TIMESTAMPTZ NULL,
  firmware_version VARCHAR(50) NULL,
  suspension_enabled BOOLEAN DEFAULT FALSE,
  notes TEXT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Control de acceso granular por OLT (RF-OLT-003)
CREATE TABLE IF NOT EXISTS net.olt_role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  olt_id UUID NOT NULL REFERENCES net.olts(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,
  can_view BOOLEAN DEFAULT TRUE,
  can_operate BOOLEAN DEFAULT FALSE,
  can_configure BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(olt_id, role)
);

-- 3. Interfaces físicas y lógicas descubiertas (PON y Uplinks)
CREATE TABLE IF NOT EXISTS net.olt_interfaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  olt_id UUID NOT NULL REFERENCES net.olts(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL, -- ej. 'gpon-olt_1/1/1', 'gei_1/3/1'
  type VARCHAR(30) NOT NULL, -- 'PON' | 'UPLINK' | 'DOWNLINK' | 'MGMT'
  slot INT NOT NULL,
  port INT NOT NULL,
  admin_state VARCHAR(20) DEFAULT 'UP',
  oper_state VARCHAR(20) DEFAULT 'UP',
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(olt_id, name)
);

-- 4. Catálogo de VLANs de la red (RF-OLT-011)
CREATE TABLE IF NOT EXISTS net.vlans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vlan_id INT NOT NULL CHECK (vlan_id >= 1 AND vlan_id <= 4094),
  name VARCHAR(100) NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'INTERNET', -- 'INTERNET' | 'IPTV' | 'MGMT' | 'TR069' | 'VOIP'
  description TEXT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vlan_id)
);

-- 5. Mapeo de VLANs a interfaces de OLT (RF-OLT-012)
CREATE TABLE IF NOT EXISTS net.olt_interface_vlans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interface_id UUID NOT NULL REFERENCES net.olt_interfaces(id) ON DELETE CASCADE,
  vlan_id UUID NOT NULL REFERENCES net.vlans(id) ON DELETE RESTRICT,
  mode VARCHAR(20) NOT NULL DEFAULT 'TAG',
  function VARCHAR(30) NULL,
  apply_status VARCHAR(30) DEFAULT 'APPLIED',
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(interface_id, vlan_id)
);

-- 6. Perfiles de velocidad OLT (RF-OLT-008)
CREATE TABLE IF NOT EXISTS net.olt_speed_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  down_kbps INT NOT NULL,
  up_kbps INT NOT NULL,
  vendor_tcont_profile VARCHAR(100) NULL,
  vendor_traffic_profile VARCHAR(100) NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Catálogo de modelos y tipos de ONU (RF-OLT-010)
CREATE TABLE IF NOT EXISTS net.onu_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor VARCHAR(50) NOT NULL,
  model VARCHAR(50) NOT NULL,
  vendor_type_name VARCHAR(100) NOT NULL, -- ej. 'ZTE-F660'
  pon_type VARCHAR(20) DEFAULT 'GPON',
  eth_ports INT DEFAULT 4,
  pots_ports INT DEFAULT 1,
  wifi_bands VARCHAR(50) DEFAULT '2.4GHz',
  catv_port BOOLEAN DEFAULT FALSE,
  supports_tr069 BOOLEAN DEFAULT TRUE,
  supports_omci BOOLEAN DEFAULT TRUE,
  supports_bridge BOOLEAN DEFAULT TRUE,
  supports_router BOOLEAN DEFAULT TRUE,
  default_mode VARCHAR(20) DEFAULT 'ROUTER',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vendor, model)
);

-- 8. Redes de administración TR-069 (RF-OLT-013)
CREATE TABLE IF NOT EXISTS net.tr069_networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  cidr VARCHAR(50) NOT NULL, -- ej. '10.15.160.0/22'
  vlan_id UUID REFERENCES net.vlans(id) ON DELETE RESTRICT,
  gateway VARCHAR(45) NOT NULL,
  dhcp_mode VARCHAR(20) DEFAULT 'DHCP_SERVER',
  acs_url VARCHAR(255) NOT NULL,
  acs_username VARCHAR(100) NULL,
  acs_password_enc TEXT NULL,
  conn_req_username VARCHAR(100) NULL,
  conn_req_password_enc TEXT NULL,
  inform_interval_sec INT DEFAULT 300,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seeding inicial de tipos de ONU comunes
INSERT INTO net.onu_types (vendor, model, vendor_type_name, pon_type, eth_ports, pots_ports, wifi_bands, catv_port, supports_tr069, supports_omci, supports_bridge, supports_router, default_mode)
VALUES 
  ('ZTE', 'F660', 'ZTE-F660', 'GPON', 4, 1, '2.4GHz', FALSE, TRUE, TRUE, TRUE, TRUE, 'ROUTER'),
  ('ZTE', 'F670L', 'ZTE-F670L', 'GPON', 4, 1, '2.4GHz / 5GHz', FALSE, TRUE, TRUE, TRUE, TRUE, 'ROUTER'),
  ('Huawei', 'HG8245H', 'HW-HG8245H', 'GPON', 4, 2, '2.4GHz', FALSE, TRUE, TRUE, TRUE, TRUE, 'ROUTER'),
  ('VSOL', 'V2801SG', 'VSOL-V2801SG', 'GPON', 1, 0, 'Sin WiFi', FALSE, TRUE, TRUE, TRUE, FALSE, 'BRIDGE')
ON CONFLICT (vendor, model) DO NOTHING;

-- Seeding inicial de perfiles de velocidad OLT representativos
INSERT INTO net.olt_speed_profiles (code, name, down_kbps, up_kbps, vendor_tcont_profile, vendor_traffic_profile)
VALUES
  ('OLT-10M', 'Perfil OLT 10 Mbps Simétrico', 10240, 10240, 'TCONT-10M', 'TRAFFIC-10M'),
  ('OLT-20M', 'Perfil OLT 20 Mbps Simétrico', 20480, 20480, 'TCONT-20M', 'TRAFFIC-20M'),
  ('OLT-50M', 'Perfil OLT 50 Mbps Simétrico', 51200, 51200, 'TCONT-50M', 'TRAFFIC-50M'),
  ('OLT-100M', 'Perfil OLT 100 Mbps Simétrico', 102400, 102400, 'TCONT-100M', 'TRAFFIC-100M')
ON CONFLICT (code) DO NOTHING;
