-- Migración 088: Inventario de Planta Externa ODN (Cajas NAP y Puertos de Salida)
CREATE TABLE IF NOT EXISTS net.nap_boxes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    olt_id UUID REFERENCES net.olts(id) ON DELETE SET NULL,
    pon_interface VARCHAR(50),
    splitter_ratio VARCHAR(20) NOT NULL DEFAULT '1:16',
    total_ports INT NOT NULL DEFAULT 16,
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    address VARCHAR(255),
    zone_id UUID REFERENCES net.zones(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS net.nap_ports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nap_id UUID NOT NULL REFERENCES net.nap_boxes(id) ON DELETE CASCADE,
    port_number INT NOT NULL,
    onu_id UUID REFERENCES net.onus(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DISPONIBLE',
    attenuation_db NUMERIC(4, 2),
    notes VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_nap_port UNIQUE (nap_id, port_number)
);

ALTER TABLE net.onus 
ADD COLUMN IF NOT EXISTS nap_port_id UUID REFERENCES net.nap_ports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_nap_boxes_olt_id ON net.nap_boxes(olt_id);
CREATE INDEX IF NOT EXISTS idx_nap_boxes_zone_id ON net.nap_boxes(zone_id);
CREATE INDEX IF NOT EXISTS idx_nap_ports_nap_id ON net.nap_ports(nap_id);
CREATE INDEX IF NOT EXISTS idx_nap_ports_onu_id ON net.nap_ports(onu_id);
CREATE INDEX IF NOT EXISTS idx_onus_nap_port_id ON net.onus(nap_port_id);
