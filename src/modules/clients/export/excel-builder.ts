import { Workbook } from 'exceljs';
import { CLIENT_EXPORT_COLUMNS, ClientExportRow } from './clients-export.types';

/**
 * Columnas que deben forzarse a texto en Excel — si no, Excel interpreta
 * documentos/teléfonos que empiezan en '0' como número y trunca ese cero.
 */
const TEXT_FORMAT_COLUMNS = new Set<keyof ClientExportRow>([
  'numeroDocumento',
  'telefono',
  'telefonoAlterno',
  'numeroContrato',
]);

export async function buildClientsExcel(rows: ClientExportRow[]): Promise<Buffer> {
  const workbook = new Workbook();
  workbook.creator = 'Sumtech ERP';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Clientes', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = CLIENT_EXPORT_COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width,
    style: TEXT_FORMAT_COLUMNS.has(col.key) ? { numFmt: '@' } : undefined,
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  headerRow.alignment = { vertical: 'middle' };

  rows.forEach((row) => {
    const excelRow = sheet.addRow(row);
    CLIENT_EXPORT_COLUMNS.forEach((col, idx) => {
      if (TEXT_FORMAT_COLUMNS.has(col.key)) {
        excelRow.getCell(idx + 1).numFmt = '@';
      }
    });
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
