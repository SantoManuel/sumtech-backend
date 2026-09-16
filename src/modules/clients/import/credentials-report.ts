export interface ImportedClientCredentials {
  name: string;
  docNumber: string;
  username: string;
  password: string;
}

const HEADERS = ['Cliente', 'Documento', 'Usuario', 'Contraseña Inicial'];

function escapeCsvValue(value: string): string {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

/**
 * Reporte descargable de usuario/contraseña por cada cliente CREADO en un
 * batch de importación masiva — es la única forma de entregar credenciales
 * cuando no hay un admin imprimiendo el contrato de cada uno en el momento
 * (el import corre en background). Mismo formato CSV (BOM + RFC4180) que el
 * export de clientes, para abrir bien en Excel con tildes/ñ.
 */
export function buildCredentialsReportCsv(rows: ImportedClientCredentials[]): Buffer {
  const header = HEADERS.map(escapeCsvValue).join(',');
  const lines = rows.map((row) =>
    [row.name, row.docNumber, row.username, row.password].map(escapeCsvValue).join(','),
  );
  const content = [header, ...lines].join('\r\n');
  const BOM = '﻿';
  return Buffer.from(BOM + content, 'utf8');
}
