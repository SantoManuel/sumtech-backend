import { CLIENT_EXPORT_COLUMNS, ClientExportRow } from './clients-export.types';

/**
 * Escapa un valor según RFC4180: se envuelve en comillas si contiene coma,
 * comilla doble, o un salto de línea — y toda comilla interna se duplica.
 */
function escapeCsvValue(value: string): string {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

/**
 * Genera un CSV UTF-8 con BOM (para que Excel abra tildes/ñ correctamente,
 * igual que los exports del sistema legacy) y terminadores CRLF.
 */
export function buildClientsCsv(rows: ClientExportRow[]): Buffer {
  const header = CLIENT_EXPORT_COLUMNS.map((col) => escapeCsvValue(col.header)).join(',');
  const lines = rows.map((row) => CLIENT_EXPORT_COLUMNS.map((col) => escapeCsvValue(row[col.key])).join(','));

  const content = [header, ...lines].join('\r\n');
  const BOM = '﻿';
  return Buffer.from(BOM + content, 'utf8');
}
