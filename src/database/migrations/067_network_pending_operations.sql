-- Migración 067: Operaciones pendientes de red y cola de reintentos (RF-SUS-001/002, RED-003, PPPOE-005/006)
-- Soporta el desacoplamiento de operaciones de suspensión y reactivación ante equipos offline.

ALTER TABLE net.network_access
  ADD COLUMN IF NOT EXISTS pending_operation VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pending_since TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pending_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(50) DEFAULT NULL;

-- Índice parcial para agilizar la búsqueda de operaciones pendientes por la cola BullMQ
CREATE INDEX IF NOT EXISTS idx_network_access_pending_op
  ON net.network_access (pending_operation)
  WHERE pending_operation IS NOT NULL;
