import { buildCsvBuffer, CsvColumn } from './csv-builder.util';

interface TestRow {
  nombre: string;
  ciudad: string;
}

const COLUMNS: CsvColumn<TestRow>[] = [
  { key: 'nombre', header: 'Nombre' },
  { key: 'ciudad', header: 'Ciudad' },
];

function makeRow(overrides: Partial<TestRow> = {}): TestRow {
  return { nombre: 'Router Azua', ciudad: 'Azua', ...overrides };
}

describe('buildCsvBuffer', () => {
  it('inicia con BOM UTF-8 (U+FEFF) para que Excel abra tildes/ñ correctamente', () => {
    const buffer = buildCsvBuffer([makeRow()], COLUMNS);
    expect(buffer.toString('utf8').charCodeAt(0)).toBe(0xfeff);
  });

  it('la primera línea (tras el BOM) es el encabezado en el orden de las columnas', () => {
    const buffer = buildCsvBuffer([makeRow()], COLUMNS);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    const [headerLine] = text.split('\r\n');
    expect(headerLine).toBe('Nombre,Ciudad');
  });

  it('escapa valores con comas envolviéndolos en comillas (RFC4180)', () => {
    const buffer = buildCsvBuffer([makeRow({ ciudad: 'Azua, RD' })], COLUMNS);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    expect(text).toContain('"Azua, RD"');
  });

  it('escapa comillas dobles internas duplicándolas', () => {
    const buffer = buildCsvBuffer([makeRow({ nombre: 'OLT "Principal"' })], COLUMNS);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    expect(text).toContain('"OLT ""Principal"""');
  });

  it('escapa saltos de línea internos envolviendo el valor en comillas', () => {
    const buffer = buildCsvBuffer([makeRow({ ciudad: 'Azua\nRD' })], COLUMNS);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    expect(text).toContain('"Azua\nRD"');
  });

  it('valores null/undefined se serializan como campo vacío, no como "undefined"/"null"', () => {
    const buffer = buildCsvBuffer([{ nombre: 'Router X', ciudad: undefined as any }], COLUMNS);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  it('con 0 filas devuelve solo el encabezado (archivo válido, no vacío ni corrupto)', () => {
    const buffer = buildCsvBuffer([], COLUMNS);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    expect(text.split('\r\n')).toEqual(['Nombre,Ciudad']);
  });

  it('serializa múltiples filas en el orden recibido', () => {
    const buffer = buildCsvBuffer([makeRow({ nombre: 'A' }), makeRow({ nombre: 'B' })], COLUMNS);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    const lines = text.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('A');
    expect(lines[2]).toContain('B');
  });
});
