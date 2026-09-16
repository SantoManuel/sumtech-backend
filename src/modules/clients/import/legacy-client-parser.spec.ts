import { Workbook } from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { parseLegacyClientCsv, parseLegacyClientExcel, parseLegacyClientFile } from './legacy-client-parser';

const LEGACY_HEADER =
  'Usuario,Nombre,Servicio,Ip,Estado,Plan Internet,Router,Zona,DNI/C.I./C.C./IFE,Direccion,Barrio/Localidad,Telefono,Saldo,Fecha Instalacion,Coordenadas,Ciudad/Municipio,Accion';

function sampleRow(overrides: Partial<Record<string, string>> = {}): string {
  const defaults = {
    usuario: 't1@tecmas',
    nombre: 'Moises Perez',
    servicio: 't1',
    ip: '192.168.60.100',
    estado: 'Suspendido',
    plan: '50.0 Mbps 1600.00',
    router: 'RB Las Yayas',
    zona: 'RB Las Yayas',
    dni: '010-00000000-0',
    direccion: 'Calle 1ra #14',
    barrio: 'Las Yayas',
    telefono: '8297477753',
    saldo: '200,00',
    fecha: '20/01/2024 12:55',
    coords: '',
    ciudad: 'Azua',
    accion: '',
    ...overrides,
  };
  // Cada campo entre comillas (como en un export real) — así un valor con
  // coma interna (ej. "200,00") no se confunde con un separador de columna.
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [
    defaults.usuario,
    defaults.nombre,
    defaults.servicio,
    defaults.ip,
    defaults.estado,
    defaults.plan,
    defaults.router,
    defaults.zona,
    defaults.dni,
    defaults.direccion,
    defaults.barrio,
    defaults.telefono,
    defaults.saldo,
    defaults.fecha,
    defaults.coords,
    defaults.ciudad,
    defaults.accion,
  ]
    .map(quote)
    .join(',');
}

describe('parseLegacyClientCsv', () => {
  it('parsea la fila de ejemplo real del formato legacy (columnas por nombre, no por posición)', () => {
    const content = `${LEGACY_HEADER}\n${sampleRow()}`;
    const result = parseLegacyClientCsv(content);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      rowNumber: 2,
      nombre: 'Moises Perez',
      docNumber: '010-00000000-0',
      telefono: '8297477753',
      direccion: 'Calle 1ra #14',
      barrio: 'Las Yayas',
      ciudadMunicipio: 'Azua',
      estado: 'Suspendido',
      planInternet: '50.0 Mbps 1600.00',
      fechaInstalacion: '20/01/2024 12:55',
      saldo: '200,00',
    });
  });

  it('ignora Usuario/Servicio/Ip/Router/Zona/Accion (no son responsabilidad de este import)', () => {
    const content = `${LEGACY_HEADER}\n${sampleRow()}`;
    const result = parseLegacyClientCsv(content);
    expect(result.rows[0]).not.toHaveProperty('usuario');
    expect(result.rows[0]).not.toHaveProperty('ip');
    expect(result.rows[0]).not.toHaveProperty('router');
  });

  it('tolera columnas reordenadas (mapeo por nombre de encabezado, no por posición)', () => {
    const header = 'Telefono,Plan Internet,Nombre,Estado,DNI/C.I./C.C./IFE';
    const row = '8095551234,50 Mbps 1000,Ana Lopez,Activo,001-1111111-1';
    const result = parseLegacyClientCsv(`${header}\n${row}`);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      nombre: 'Ana Lopez',
      docNumber: '001-1111111-1',
      telefono: '8095551234',
      estado: 'Activo',
      planInternet: '50 Mbps 1000',
    });
  });

  it('encabezado con menos de 5 columnas reconocidas -> BadRequestException', () => {
    const content = 'Nombre,DNI/C.I./C.C./IFE,Telefono\nAna Lopez,001-1111111-1,8095551234';
    expect(() => parseLegacyClientCsv(content)).toThrow(BadRequestException);
  });

  it('detecta el delimitador punto y coma automáticamente', () => {
    const header = LEGACY_HEADER.replace(/,/g, ';');
    const row = sampleRow().replace(/,/g, ';');
    const result = parseLegacyClientCsv(`${header}\n${row}`);
    expect(result.rows[0].nombre).toBe('Moises Perez');
  });

  it('respeta comillas con comas internas', () => {
    const content = `${LEGACY_HEADER}\n${sampleRow({ direccion: 'Calle 1ra #14, esquina Duarte' })}`;
    const result = parseLegacyClientCsv(content);
    expect(result.rows[0].direccion).toBe('Calle 1ra #14, esquina Duarte');
  });

  it('preserva tildes y ñ', () => {
    const content = `${LEGACY_HEADER}\n${sampleRow({ nombre: 'José Peña Núñez' })}`;
    const result = parseLegacyClientCsv(content);
    expect(result.rows[0].nombre).toBe('José Peña Núñez');
  });

  it('archivo vacío -> BadRequestException', () => {
    expect(() => parseLegacyClientCsv('')).toThrow(BadRequestException);
  });

  it('encabezado no reconocible -> BadRequestException (nunca procesa en silencio un archivo equivocado)', () => {
    const content = 'ColumnaX,ColumnaY,ColumnaZ\nvalor1,valor2,valor3';
    expect(() => parseLegacyClientCsv(content)).toThrow(BadRequestException);
  });

  it('múltiples filas de datos, numeradas correctamente (encabezado = fila 1)', () => {
    const content = `${LEGACY_HEADER}\n${sampleRow({ nombre: 'Cliente A' })}\n${sampleRow({ nombre: 'Cliente B' })}`;
    const result = parseLegacyClientCsv(content);
    expect(result.rows[0].rowNumber).toBe(2);
    expect(result.rows[1].rowNumber).toBe(3);
    expect(result.rows.map((r) => r.nombre)).toEqual(['Cliente A', 'Cliente B']);
  });

  it('filas completamente en blanco se ignoran', () => {
    const content = `${LEGACY_HEADER}\n${sampleRow()}\n\n\n`;
    const result = parseLegacyClientCsv(content);
    expect(result.rows).toHaveLength(1);
  });
});

describe('parseLegacyClientExcel', () => {
  async function buildWorkbookBuffer(headers: string[], rows: string[][]): Promise<Buffer> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Clientes');
    sheet.addRow(headers);
    rows.forEach((r) => sheet.addRow(r));
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  const headers = [
    'Usuario',
    'Nombre',
    'Servicio',
    'Ip',
    'Estado',
    'Plan Internet',
    'Router',
    'Zona',
    'DNI/C.I./C.C./IFE',
    'Direccion',
    'Barrio/Localidad',
    'Telefono',
    'Saldo',
    'Fecha Instalacion',
    'Coordenadas',
    'Ciudad/Municipio',
    'Accion',
  ];

  it('parsea un .xlsx con el mismo formato legacy', async () => {
    const buffer = await buildWorkbookBuffer(headers, [
      [
        't1@tecmas',
        'Moises Perez',
        't1',
        '192.168.60.100',
        'Suspendido',
        '50.0 Mbps 1600.00',
        'RB Las Yayas',
        'RB Las Yayas',
        '010-00000000-0',
        'Calle 1ra #14',
        'Las Yayas',
        '8297477753',
        '200,00',
        '20/01/2024 12:55',
        '',
        'Azua',
        '',
      ],
    ]);

    const result = await parseLegacyClientExcel(buffer);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      nombre: 'Moises Perez',
      docNumber: '010-00000000-0',
      telefono: '8297477753',
      barrio: 'Las Yayas',
      ciudadMunicipio: 'Azua',
    });
  });

  it('ignora filas completamente vacías dentro del archivo', async () => {
    const buffer = await buildWorkbookBuffer(headers, [
      ['', 'Cliente A', '', '', '', '50 Mbps 1000', '', '', '001-0000001-1', '', '', '8091110000', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['', 'Cliente B', '', '', '', '50 Mbps 1000', '', '', '001-0000002-2', '', '', '8092220000', '', '', '', '', ''],
    ]);

    const result = await parseLegacyClientExcel(buffer);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.nombre)).toEqual(['Cliente A', 'Cliente B']);
  });

  it('archivo sin hojas o vacío -> BadRequestException', async () => {
    const workbook = new Workbook();
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    await expect(parseLegacyClientExcel(Buffer.from(arrayBuffer))).rejects.toThrow(BadRequestException);
  });
});

describe('parseLegacyClientFile', () => {
  it('despacha .csv al parser de CSV', async () => {
    const content = `${LEGACY_HEADER}\n${sampleRow()}`;
    const result = await parseLegacyClientFile(Buffer.from(content, 'utf8'), 'clientes.csv');
    expect(result.rows).toHaveLength(1);
  });

  it('despacha .xlsx al parser de Excel', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Clientes');
    sheet.addRow(['Nombre', 'DNI/C.I./C.C./IFE', 'Telefono', 'Plan Internet', 'Estado']);
    sheet.addRow(['Ana Lopez', '001-1111111-1', '8095551234', '50 Mbps 1000', 'Activo']);
    const arrayBuffer = await workbook.xlsx.writeBuffer();

    const result = await parseLegacyClientFile(Buffer.from(arrayBuffer), 'clientes.xlsx');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].nombre).toBe('Ana Lopez');
  });

  it('extensión no soportada -> BadRequestException', async () => {
    await expect(parseLegacyClientFile(Buffer.from('x'), 'clientes.pdf')).rejects.toThrow(BadRequestException);
  });
});
