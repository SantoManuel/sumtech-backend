import { ClientLookupEntry, ImportException, ImportPlan, ImportPlanItem, LegacyConnectionStatus, LegacyNetworkRow } from './types';

const STATUS_MAP: Record<string, LegacyConnectionStatus> = {
  activo: 'ACTIVE',
  active: 'ACTIVE',
  suspendido: 'SUSPENDED',
  suspended: 'SUSPENDED',
  cortado: 'CUT',
  desconectado: 'CUT',
  cancelado: 'CUT',
  cut: 'CUT',
  pendiente: 'PENDING',
  pending: 'PENDING',
};

/** Quita todo lo que no sea letra o número, en mayúsculas — para poder comparar "010-00000000-0" contra "0100000000-0" sin que el formato del guión decida. */
export function normalizeDocNumber(docNumber: string): string {
  return docNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** Devuelve null si el estado no se reconoce — nunca asume un valor por defecto para un estado presente pero desconocido. */
export function mapConnectionStatus(estado: string): LegacyConnectionStatus | null {
  const key = estado
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .trim();
  return STATUS_MAP[key] ?? null;
}

/**
 * Decide, fila por fila, a qué contrato corresponde cada acceso de red del
 * export heredado — sin tocar la base de datos (recibe los clientes/contratos
 * ya cargados en `clientsByNormalizedDoc`). Esto la hace pura y fácil de
 * probar: la ambigüedad (documento no encontrado, cliente con más de un
 * contrato, estado de red desconocido) siempre se reporta como excepción,
 * nunca se resuelve adivinando — ver el riesgo "no descartar silenciosamente"
 * del plan de integración.
 */
export function buildImportPlan(
  rows: LegacyNetworkRow[],
  clientsByNormalizedDoc: Map<string, ClientLookupEntry>,
): ImportPlan {
  const items: ImportPlanItem[] = [];
  const exceptions: ImportException[] = [];

  for (const row of rows) {
    const normalizedDoc = normalizeDocNumber(row.docNumber || '');
    if (!normalizedDoc) {
      exceptions.push({ rowNumber: row.rowNumber, docNumber: row.docNumber, reason: 'La fila no tiene número de documento.' });
      continue;
    }

    const client = clientsByNormalizedDoc.get(normalizedDoc);
    if (!client) {
      exceptions.push({
        rowNumber: row.rowNumber,
        docNumber: row.docNumber,
        reason: `No se encontró ningún cliente con el documento "${row.docNumber}".`,
      });
      continue;
    }

    if (client.contracts.length === 0) {
      exceptions.push({
        rowNumber: row.rowNumber,
        docNumber: row.docNumber,
        reason: 'El cliente no tiene contratos vigentes (no TERMINATED) para asignarle este acceso de red.',
      });
      continue;
    }

    if (client.contracts.length > 1) {
      const numbers = client.contracts.map((c) => c.contractNumber).join(', ');
      exceptions.push({
        rowNumber: row.rowNumber,
        docNumber: row.docNumber,
        reason: `El cliente tiene ${client.contracts.length} contratos vigentes (${numbers}); requiere selección manual de a cuál asignar este acceso.`,
      });
      continue;
    }

    let connectionStatus: LegacyConnectionStatus = 'PENDING';
    if (row.estado && row.estado.trim()) {
      const mapped = mapConnectionStatus(row.estado);
      if (!mapped) {
        exceptions.push({
          rowNumber: row.rowNumber,
          docNumber: row.docNumber,
          reason: `Estado de red desconocido: "${row.estado}".`,
        });
        continue;
      }
      connectionStatus = mapped;
    }

    const contract = client.contracts[0];
    items.push({
      rowNumber: row.rowNumber,
      clientId: client.clientId,
      contractId: contract.contractId,
      contractNumber: contract.contractNumber,
      zoneName: row.zona?.trim() || undefined,
      nodeName: row.router?.trim() || undefined,
      username: row.usuario?.trim() || undefined,
      serviceAlias: row.servicio?.trim() || undefined,
      ipAddress: row.ip?.trim() || undefined,
      connectionStatus,
    });
  }

  return { items, exceptions };
}
