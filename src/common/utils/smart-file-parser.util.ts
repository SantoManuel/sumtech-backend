import { Workbook } from 'exceljs';
import { BadRequestException } from '@nestjs/common';

/**
 * Motor genérico de reconocimiento de columnas para importaciones masivas
 * desde CSV/TSV/Excel: detecta el delimitador automáticamente, mapea
 * encabezados a campos internos por nombre (tolerante a tildes/mayúsculas/
 * orden de columnas) en vez de exigir un orden fijo, y soporta CSV y XLSX con
 * la misma lógica de mapeo.
 *
 * Generaliza la técnica ya probada en producción de
 * `modules/clients/import/legacy-client-parser.ts` — se construyó como una
 * utilidad nueva e independiente (no un refactor de ese archivo) a propósito,
 * para no arriesgar el import de clientes ya en producción.
 */

export interface SmartParseResult<TField extends string> {
  /** Una fila por cada fila de datos del archivo (encabezado excluido). */
  rows: Array<Record<TField, string> & { rowNumber: number }>;
  /** Encabezados normalizados que sí se lograron mapear a un campo conocido. */
  recognizedColumns: string[];
  /** Total de columnas que traía el archivo (reconocidas o no). */
  totalColumns: number;
}

/**
 * Normaliza un encabezado para compararlo de forma robusta a mayúsculas,
 * tildes y espacios repetidos — un archivo reabierto y re-guardado con otra
 * codificación puede llegar con "Categoría" sin el acento.
 */
export function normalizeHeader(value: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Separador de campos respetando comillas ("campo con , adentro"). */
function splitDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map((cell) => cell.trim());
}

function detectDelimiter(headerLine: string, headerFieldMap: Record<string, string>): string {
  const candidates = ['\t', ';', ','];
  let best = { delimiter: ',', score: -1 };

  for (const delimiter of candidates) {
    const score = splitDelimitedLine(headerLine, delimiter)
      .map(normalizeHeader)
      .filter((cell) => headerFieldMap[cell]).length;
    if (score > best.score) {
      best = { delimiter, score };
    }
  }
  return best.delimiter;
}

function mapCellsToRows<TField extends string>(
  headerCells: string[],
  dataRows: string[][],
  headerFieldMap: Record<string, TField>,
  minRecognizedHeaders: number,
): SmartParseResult<TField> {
  const normalizedHeaders = headerCells.map(normalizeHeader);
  const fieldByColumn: (TField | null)[] = normalizedHeaders.map((cell) => headerFieldMap[cell] ?? null);
  const recognizedColumns = normalizedHeaders.filter((cell) => headerFieldMap[cell]);

  if (recognizedColumns.length < minRecognizedHeaders) {
    throw new BadRequestException(
      `No se reconocieron suficientes columnas del archivo (solo ${recognizedColumns.length} de ${minRecognizedHeaders} mínimas). ` +
        `Encabezado recibido: "${headerCells.filter((c) => c.length > 0).join(', ')}"`,
    );
  }

  const rows = dataRows.map((cells, index) => {
    const row = { rowNumber: index + 2 } as Record<TField, string> & { rowNumber: number };
    fieldByColumn.forEach((field, columnIndex) => {
      if (field) {
        (row as any)[field] = (cells[columnIndex] ?? '').trim();
      }
    });
    return row;
  });

  return { rows, recognizedColumns, totalColumns: headerCells.length };
}

/** Parsea contenido CSV/TSV plano, detectando el delimitador automáticamente. */
export function parseSmartCsv<TField extends string>(
  content: string,
  headerFieldMap: Record<string, TField>,
  minRecognizedHeaders: number,
): SmartParseResult<TField> {
  const lines = content.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new BadRequestException('El archivo está vacío.');
  }

  const delimiter = detectDelimiter(lines[0], headerFieldMap);
  const headerCells = splitDelimitedLine(lines[0], delimiter);
  const dataRows = lines.slice(1).map((line) => splitDelimitedLine(line, delimiter));

  return mapCellsToRows(headerCells, dataRows, headerFieldMap, minRecognizedHeaders);
}

function toStringCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value !== null && 'text' in (value as any)) {
    return String((value as any).text ?? '');
  }
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/** Parsea un archivo .xlsx (primera hoja), misma lógica de columnas por nombre. */
export async function parseSmartExcel<TField extends string>(
  buffer: Buffer,
  headerFieldMap: Record<string, TField>,
  minRecognizedHeaders: number,
): Promise<SmartParseResult<TField>> {
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0) {
    throw new BadRequestException('El archivo Excel está vacío o no tiene hojas.');
  }

  const headerRow = sheet.getRow(1);
  const headerCells: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    headerCells.push(toStringCell(cell.value));
  });

  const dataRows: string[][] = [];
  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex++) {
    const row = sheet.getRow(rowIndex);
    if (row.actualCellCount === 0) continue;
    const cells: string[] = [];
    for (let colIndex = 1; colIndex <= headerCells.length; colIndex++) {
      cells.push(toStringCell(row.getCell(colIndex).value));
    }
    if (cells.some((cell) => cell.length > 0)) {
      dataRows.push(cells);
    }
  }

  return mapCellsToRows(headerCells, dataRows, headerFieldMap, minRecognizedHeaders);
}

/** Despacha por extensión de archivo (.csv/.txt/.tsv -> texto plano, .xlsx/.xls -> Excel). */
export async function parseSmartFile<TField extends string>(
  buffer: Buffer,
  filename: string,
  headerFieldMap: Record<string, TField>,
  minRecognizedHeaders: number,
): Promise<SmartParseResult<TField>> {
  const extension = (filename || '').toLowerCase().split('.').pop();
  if (extension === 'csv' || extension === 'txt' || extension === 'tsv') {
    return parseSmartCsv(buffer.toString('utf8'), headerFieldMap, minRecognizedHeaders);
  }
  if (extension === 'xlsx' || extension === 'xls') {
    return parseSmartExcel(buffer, headerFieldMap, minRecognizedHeaders);
  }
  throw new BadRequestException(`Formato de archivo no soportado: .${extension || '(sin extensión)'}. Use .csv o .xlsx.`);
}

/**
 * Parsea un monto monetario tolerando separador de miles y símbolo de moneda
 * (ej. "RD$1,600.00", "1.600,00", "1600"). Nunca lanza: vacío o inválido = 0.
 */
export function parseMoneyAmount(raw: string | undefined | null): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;
  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Si el último separador es una coma, es formato europeo (1.600,00) ->
    // el punto es de miles y la coma es decimal. Si no, es formato US
    // (1,600.00) -> la coma es de miles.
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.');
  }
  const value = parseFloat(normalized);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Interpreta valores tipo booleano en español/inglés tolerando variantes comunes. */
export function parseYesNo(raw: string | undefined | null, defaultValue = false): boolean {
  const key = normalizeHeader(raw || '');
  if (!key) return defaultValue;
  if (['si', 's', 'yes', 'y', 'true', '1', 'x'].includes(key)) return true;
  if (['no', 'n', 'false', '0'].includes(key)) return false;
  return defaultValue;
}
