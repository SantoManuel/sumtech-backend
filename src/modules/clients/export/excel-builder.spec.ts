import { Workbook } from 'exceljs';
import { buildClientsExcel } from './excel-builder';
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

async function readBackWorkbook(buffer: Buffer): Promise<Workbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as any);
  return workbook;
}

describe('buildClientsExcel', () => {
  it('genera un buffer .xlsx válido (firma ZIP "PK")', async () => {
    const buffer = await buildClientsExcel([makeRow()]);
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('la fila de encabezado contiene las 19 columnas en el orden esperado', async () => {
    const buffer = await buildClientsExcel([makeRow()]);
    const workbook = await readBackWorkbook(buffer);
    const sheet = workbook.getWorksheet('Clientes');
    expect(sheet).toBeDefined();

    const headerValues = (sheet!.getRow(1).values as any[]).slice(1).map((v) => String(v));
    expect(headerValues).toEqual(CLIENT_EXPORT_COLUMNS.map((c) => c.header));
  });

  it('escribe cada fila de datos en el orden recibido', async () => {
    const buffer = await buildClientsExcel([makeRow({ nombre: 'Cliente A' }), makeRow({ nombre: 'Cliente B' })]);
    const workbook = await readBackWorkbook(buffer);
    const sheet = workbook.getWorksheet('Clientes')!;

    expect(sheet.getRow(2).getCell(1).value).toBe('Cliente A');
    expect(sheet.getRow(3).getCell(1).value).toBe('Cliente B');
  });

  it('fuerza formato de texto en Número de Documento (columna 4) para no perder ceros a la izquierda', async () => {
    const buffer = await buildClientsExcel([makeRow({ numeroDocumento: '001-0000001-0' })]);
    const workbook = await readBackWorkbook(buffer);
    const sheet = workbook.getWorksheet('Clientes')!;

    const docCell = sheet.getRow(2).getCell(4);
    expect(docCell.value).toBe('001-0000001-0');
    expect(docCell.numFmt).toBe('@');
  });

  it('con 0 filas genera un archivo válido con solo el encabezado', async () => {
    const buffer = await buildClientsExcel([]);
    const workbook = await readBackWorkbook(buffer);
    const sheet = workbook.getWorksheet('Clientes')!;
    expect(sheet.rowCount).toBe(1);
  });

  it('preserva tildes/ñ sin corromperlas', async () => {
    const buffer = await buildClientsExcel([makeRow({ nombre: 'José Peña Núñez' })]);
    const workbook = await readBackWorkbook(buffer);
    const sheet = workbook.getWorksheet('Clientes')!;
    expect(sheet.getRow(2).getCell(1).value).toBe('José Peña Núñez');
  });

  it('la fila de encabezado tiene el estilo en negrita definido', async () => {
    const buffer = await buildClientsExcel([makeRow()]);
    const workbook = await readBackWorkbook(buffer);
    const sheet = workbook.getWorksheet('Clientes')!;
    expect(sheet.getRow(1).font?.bold).toBe(true);
  });
});
