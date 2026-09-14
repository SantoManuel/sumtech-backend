import { LegacyNetworkRow } from './types';

/**
 * Encabezados exactos de la hoja del sistema WISP anterior (ver el análisis
 * de migración): Usuario, Nombre, Servicio, Ip, Estado, Plan Internet,
 * Router, Zona, DNI/C.I./C.C./IFE, Dirección, Barrio/Localidad, Telefono,
 * Saldo, Fecha Instalación, Coordenadas, Ciudad/Municipio, Acción.
 * "Acción" no se mapea: es una columna de interfaz del sistema viejo, no un
 * dato del cliente (ver informe de análisis).
 */
const HEADER_FIELD_MAP: Record<string, keyof LegacyNetworkRow> = {
  usuario: 'usuario',
  nombre: 'nombre',
  servicio: 'servicio',
  ip: 'ip',
  estado: 'estado',
  'plan internet': 'planInternet',
  router: 'router',
  zona: 'zona',
  'dni/c.i./c.c./ife': 'docNumber',
  direccion: 'direccion',
  'barrio/localidad': 'barrio',
  telefono: 'telefono',
  saldo: 'saldo',
  'fecha instalacion': 'fechaInstalacion',
  coordenadas: 'coordenadas',
  'ciudad/municipio': 'ciudadMunicipio',
};

const MIN_RECOGNIZED_HEADERS = 8;

/**
 * Normaliza un encabezado para compararlo de forma robusta a mayúsculas,
 * tildes y espacios repetidos — un export viejo reabierto y re-guardado con
 * otra codificación puede llegar con "Dirección" convertido en "DirecciÃ³n"
 * o simplemente sin el acento; ver la nota de encoding en el informe.
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

/**
 * Parsea el export del sistema WISP anterior por nombre de columna (no por
 * posición fija): tolera columnas reordenadas y detecta el delimitador
 * (tab/punto y coma/coma) automáticamente a partir del encabezado.
 *
 * @throws si el archivo está vacío o si el encabezado no coincide con el
 * formato heredado (para no procesar en silencio un archivo equivocado).
 */
export function parseLegacyNetworkCsv(content: string): LegacyNetworkRow[] {
  const lines = content.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error('El archivo está vacío.');
  }

  const delimiter = detectDelimiter(lines[0]);
  const headerCells = splitDelimitedLine(lines[0], delimiter).map(normalizeHeader);
  const fieldByColumn: (keyof LegacyNetworkRow | null)[] = headerCells.map((cell) => HEADER_FIELD_MAP[cell] ?? null);

  const recognizedCount = fieldByColumn.filter(Boolean).length;
  if (recognizedCount < MIN_RECOGNIZED_HEADERS) {
    throw new Error(
      `No se reconocieron suficientes columnas del formato heredado (solo ${recognizedCount} de ${MIN_RECOGNIZED_HEADERS} mínimas). ` +
        `Encabezado recibido: "${lines[0]}"`,
    );
  }

  const rows: LegacyNetworkRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitDelimitedLine(lines[i], delimiter);
    const row = { rowNumber: i + 1 } as LegacyNetworkRow;
    fieldByColumn.forEach((field, columnIndex) => {
      if (field) {
        (row as any)[field] = (cells[columnIndex] ?? '').trim();
      }
    });
    rows.push(row);
  }
  return rows;
}
