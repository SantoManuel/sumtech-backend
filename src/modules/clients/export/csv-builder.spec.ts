import { buildClientsCsv } from './csv-builder';
import { CLIENT_EXPORT_COLUMNS, ClientExportRow } from './clients-export.types';

function makeRow(overrides: Partial<ClientExportRow> = {}): ClientExportRow {
  return {
    nombre: 'Moises Perez',
    tipoCliente: 'Física',
    tipoDocumento: 'CEDULA',
    numeroDocumento: '010-0000000-0',
    telefono: '8297477753',
    telefonoAlterno: '',
    email: 'moises@example.com',
    direccion: 'Calle 1ra #14',
    sectorBarrio: 'Las Yayas',
    municipio: 'Azua',
    provinciaCiudad: 'Azua',
    coordenadasGps: '',
    planActivo: 'Fibra 50',
    numeroContrato: 'C-0001',
    fechaInicioContrato: '20/01/2024',
    estadoContrato: 'Activo',
    estadoCliente: 'Activo',
    fechaAlta: '15/01/2024',
    clienteId: 'client-1',
    ...overrides,
  };
}

describe('buildClientsCsv', () => {
  it('inicia con BOM UTF-8 (U+FEFF) para que Excel abra tildes/ñ correctamente', () => {
    const buffer = buildClientsCsv([makeRow()]);
    expect(buffer.toString('utf8').charCodeAt(0)).toBe(0xfeff);
  });

  it('la primera línea (tras el BOM) es el encabezado con las 19 columnas en orden', () => {
    const buffer = buildClientsCsv([makeRow()]);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    const [headerLine] = text.split('\r\n');
    const expectedHeader = CLIENT_EXPORT_COLUMNS.map((c) => c.header).join(',');
    expect(headerLine).toBe(expectedHeader);
  });

  it('serializa una fila simple sin comillas cuando no hay caracteres especiales', () => {
    const buffer = buildClientsCsv([makeRow()]);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    const lines = text.split('\r\n');
    expect(lines[1]).toContain('Moises Perez');
    expect(lines[1]).toContain('8297477753');
  });

  it('escapa valores con comas envolviéndolos en comillas (RFC4180)', () => {
    const buffer = buildClientsCsv([makeRow({ direccion: 'Calle 1ra #14, esquina Duarte' })]);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    expect(text).toContain('"Calle 1ra #14, esquina Duarte"');
  });

  it('escapa comillas dobles internas duplicándolas', () => {
    const buffer = buildClientsCsv([makeRow({ nombre: 'Empresa "El Progreso" SRL' })]);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    expect(text).toContain('"Empresa ""El Progreso"" SRL"');
  });

  it('escapa saltos de línea internos envolviendo el valor en comillas', () => {
    const buffer = buildClientsCsv([makeRow({ direccion: 'Calle 1\nApto 2' })]);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    expect(text).toContain('"Calle 1\nApto 2"');
  });

  it('preserva caracteres acentuados y ñ sin corromperlos', () => {
    const buffer = buildClientsCsv([makeRow({ nombre: 'José Peña Núñez' })]);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    expect(text).toContain('José Peña Núñez');
  });

  it('con 0 filas devuelve solo el encabezado (archivo válido, no vacío ni corrupto)', () => {
    const buffer = buildClientsCsv([]);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    const lines = text.split('\r\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(CLIENT_EXPORT_COLUMNS.map((c) => c.header).join(','));
  });

  it('serializa múltiples filas en el orden recibido', () => {
    const buffer = buildClientsCsv([makeRow({ nombre: 'Cliente A' }), makeRow({ nombre: 'Cliente B' })]);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    const lines = text.split('\r\n');
    expect(lines).toHaveLength(3); // header + 2 filas
    expect(lines[1]).toContain('Cliente A');
    expect(lines[2]).toContain('Cliente B');
  });

  it('columnas vacías (cliente sin contrato/dirección) se serializan como campo vacío, no como "undefined"', () => {
    const buffer = buildClientsCsv([
      makeRow({ planActivo: 'Sin Contrato', numeroContrato: '', direccion: '', coordenadasGps: '' }),
    ]);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });
});
