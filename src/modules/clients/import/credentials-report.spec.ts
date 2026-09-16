import { buildCredentialsReportCsv } from './credentials-report';

describe('buildCredentialsReportCsv', () => {
  it('inicia con BOM UTF-8 y encabezado con las 4 columnas', () => {
    const buffer = buildCredentialsReportCsv([]);
    const text = buffer.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.replace(/^﻿/, '')).toBe('Cliente,Documento,Usuario,Contraseña Inicial');
  });

  it('serializa una fila con nombre, documento, usuario y contraseña', () => {
    const buffer = buildCredentialsReportCsv([
      { name: 'Moises Perez', docNumber: '010-00000000-0', username: '010000000000', password: 'Ab3dEf' },
    ]);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    const lines = text.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('Moises Perez,010-00000000-0,010000000000,Ab3dEf');
  });

  it('escapa nombres con comas (RFC4180)', () => {
    const buffer = buildCredentialsReportCsv([
      { name: 'Empresa, S.R.L.', docNumber: '131-000000-1', username: 'x', password: 'y' },
    ]);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    expect(text).toContain('"Empresa, S.R.L."');
  });

  it('preserva tildes/ñ', () => {
    const buffer = buildCredentialsReportCsv([
      { name: 'José Peña Núñez', docNumber: '001-0000000-1', username: 'jose', password: 'abc123' },
    ]);
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    expect(text).toContain('José Peña Núñez');
  });

  it('serializa múltiples filas en el orden recibido', () => {
    const buffer = buildCredentialsReportCsv([
      { name: 'Cliente A', docNumber: 'doc-a', username: 'a', password: 'pa' },
      { name: 'Cliente B', docNumber: 'doc-b', username: 'b', password: 'pb' },
    ]);
    const lines = buffer.toString('utf8').replace(/^﻿/, '').split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('Cliente A');
    expect(lines[2]).toContain('Cliente B');
  });
});
