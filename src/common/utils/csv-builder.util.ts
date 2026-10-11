/**
 * Igual escapado/BOM/CRLF que `modules/clients/export/csv-builder.ts` (el
 * export de Clientes no se tocó para no arriesgar ese flujo ya en producción)
 * pero genérico, para que lo reutilicen los exports de Nodos MikroTik y OLTs.
 */
function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export interface CsvColumn<T> {
  key: keyof T;
  header: string;
}

export function buildCsvBuffer<T extends Record<string, any>>(rows: T[], columns: CsvColumn<T>[]): Buffer {
  const header = columns.map((col) => escapeCsvValue(col.header)).join(',');
  const lines = rows.map((row) => columns.map((col) => escapeCsvValue(row[col.key])).join(','));

  const content = [header, ...lines].join('\r\n');
  const BOM = '﻿';
  return Buffer.from(BOM + content, 'utf8');
}
