import { Workbook } from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { LegacyClientRow, LegacyClientParseResult } from './legacy-client-row.types';

/**
 * Encabezados del export legacy relevantes para clientes (subconjunto de las
 * 17 columnas del sistema WISP anterior — ver el análisis de migración).
 * Usuario/Servicio/Ip/Router/Zona/Acción no se mapean aquí: son del módulo
 * de red (ver legacy-client-row.types.ts).
 */
const HEADER_FIELD_MAP: Record<string, keyof LegacyClientRow> = {
  nombre: 'nombre',
  'dni/c.i./c.c./ife': 'docNumber',
  telefono: 'telefono',
  direccion: 'direccion',
  'barrio/localidad': 'barrio',
  'ciudad/municipio': 'ciudadMunicipio',
  coordenadas: 'coordenadas',
  estado: 'estado',
  'plan internet': 'planInternet',
  'fecha instalacion': 'fechaInstalacion',
  saldo: 'saldo',
};

const MIN_RECOGNIZED_HEADERS = 5;

/**
 * Normaliza un encabezado para compararlo de forma robusta a mayúsculas,
 * tildes y espacios repetidos — un export viejo reabierto y re-guardado con
 * otra codificación puede llegar con "Dirección" sin el acento.
 */
function normalizeHeader(value: string): string {
  return value
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

function detectDelimiter(headerLine: string): string {
  const candidates = ['\t', ';', ','];
  let best = { delimiter: ',', score: -1 };

  for (const delimiter of candidates) {
    const score = splitDelimitedLine(headerLine, delimiter)
      .map(normalizeHeader)
      .filter((cell) => HEADER_FIELD_MAP[cell]).length;
    if (score > best.score) {
      best = { delimiter, score };
    }
  }
  return best.delimiter;
}

function mapCellsToRows(headerCells: string[], dataRows: string[][]): LegacyClientParseResult {
  const normalizedHeaders = headerCells.map(normalizeHeader);
  const fieldByColumn: (keyof LegacyClientRow | null)[] = normalizedHeaders.map((cell) => HEADER_FIELD_MAP[cell] ?? null);
  const recognizedColumns = normalizedHeaders.filter((cell) => HEADER_FIELD_MAP[cell]);

  if (recognizedColumns.length < MIN_RECOGNIZED_HEADERS) {
    throw new BadRequestException(
      `No se reconocieron suficientes columnas del formato legado (solo ${recognizedColumns.length} de ${MIN_RECOGNIZED_HEADERS} mínimas). ` +
        `Encabezado recibido: "${headerCells.join(', ')}"`,
    );
  }

  const rows: LegacyClientRow[] = dataRows.map((cells, index) => {
    const row = { rowNumber: index + 2 } as LegacyClientRow;
    fieldByColumn.forEach((field, columnIndex) => {
      if (field) {
        (row as any)[field] = (cells[columnIndex] ?? '').trim();
      }
    });
    return row;
  });

  return { rows, recognizedColumns };
}

/**
 * Parsea el export CSV/TSV del sistema WISP anterior por nombre de columna
 * (no por posición), tolerando columnas reordenadas y detectando el
 * delimitador (tab/punto y coma/coma) automáticamente.
 */
export function parseLegacyClientCsv(content: string): LegacyClientParseResult {
  const lines = content.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new BadRequestException('El archivo está vacío.');
  }

  const delimiter = detectDelimiter(lines[0]);
  const headerCells = splitDelimitedLine(lines[0], delimiter);
  const dataRows = lines.slice(1).map((line) => splitDelimitedLine(line, delimiter));

  return mapCellsToRows(headerCells, dataRows);
}

/** Parsea el export .xlsx del sistema WISP anterior (misma lógica de columnas por nombre). */
export async function parseLegacyClientExcel(buffer: Buffer): Promise<LegacyClientParseResult> {
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0) {
    throw new BadRequestException('El archivo Excel está vacío o no tiene hojas.');
  }

  const toStringCell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object' && value !== null && 'text' in (value as any)) {
      return String((value as any).text ?? '');
    }
    if (value instanceof Date) return value.toISOString();
    return String(value).trim();
  };

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

  return mapCellsToRows(headerCells, dataRows);
}

/** Despacha por extensión de archivo. */
export async function parseLegacyClientFile(buffer: Buffer, filename: string): Promise<LegacyClientParseResult> {
  const extension = filename.toLowerCase().split('.').pop();
  if (extension === 'csv' || extension === 'txt' || extension === 'tsv') {
    return parseLegacyClientCsv(buffer.toString('utf8'));
  }
  if (extension === 'xlsx' || extension === 'xls') {
    return parseLegacyClientExcel(buffer);
  }
  throw new BadRequestException(`Formato de archivo no soportado: .${extension || '(sin extensión)'}. Use .csv o .xlsx.`);
}
