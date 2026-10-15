import { Workbook } from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import {
  normalizeHeader,
  parseSmartCsv,
  parseSmartExcel,
  parseSmartFile,
  parseMoneyAmount,
  parseYesNo,
} from './smart-file-parser.util';

type TestField = 'nombre' | 'sku' | 'categoria';

const FIELD_MAP: Record<string, TestField> = {
  nombre: 'nombre',
  'sku/codigo': 'sku',
  categoria: 'categoria',
};

describe('smart-file-parser.util', () => {
  describe('normalizeHeader', () => {
    it('quita tildes, pasa a minúsculas y colapsa espacios repetidos', () => {
      expect(normalizeHeader('  Categoría   Producto ')).toBe('categoria producto');
      expect(normalizeHeader('SKU/Código')).toBe('sku/codigo');
    });

    it('maneja undefined/null/vacío sin lanzar', () => {
      expect(normalizeHeader(undefined as unknown as string)).toBe('');
      expect(normalizeHeader(null as unknown as string)).toBe('');
      expect(normalizeHeader('')).toBe('');
    });
  });

  describe('parseSmartCsv', () => {
    it('reconoce columnas por nombre sin importar el orden', () => {
      const content = 'SKU/Codigo,Categoria,Nombre\nONU-100,ONU,ONU GPON XYZ\nROU-50,Router,Router WiFi 6';
      const result = parseSmartCsv(content, FIELD_MAP, 2);

      expect(result.recognizedColumns.sort()).toEqual(['categoria', 'nombre', 'sku/codigo'].sort());
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({ rowNumber: 2, nombre: 'ONU GPON XYZ', sku: 'ONU-100', categoria: 'ONU' });
      expect(result.rows[1]).toEqual({ rowNumber: 3, nombre: 'Router WiFi 6', sku: 'ROU-50', categoria: 'Router' });
    });

    it('detecta el delimitador automáticamente (punto y coma)', () => {
      const content = 'Nombre;SKU/Codigo;Categoria\nONU A;ONU-1;ONU';
      const result = parseSmartCsv(content, FIELD_MAP, 2);
      expect(result.rows[0]).toEqual({ rowNumber: 2, nombre: 'ONU A', sku: 'ONU-1', categoria: 'ONU' });
    });

    it('detecta el delimitador automáticamente (tab)', () => {
      const content = 'Nombre\tSKU/Codigo\tCategoria\nONU B\tONU-2\tONU';
      const result = parseSmartCsv(content, FIELD_MAP, 2);
      expect(result.rows[0]).toEqual({ rowNumber: 2, nombre: 'ONU B', sku: 'ONU-2', categoria: 'ONU' });
    });

    it('tolera tildes/mayúsculas distintas en el encabezado real', () => {
      const content = 'NOMBRE,SKU/CÓDIGO,CATEGORÍA\nEquipo,SKU-1,Cat';
      const result = parseSmartCsv(content, FIELD_MAP, 2);
      expect(result.rows[0]).toEqual({ rowNumber: 2, nombre: 'Equipo', sku: 'SKU-1', categoria: 'Cat' });
    });

    it('respeta comas dentro de campos entrecomillados', () => {
      const content = 'Nombre,SKU/Codigo,Categoria\n"Router, Dual Band",ROU-1,Router';
      const result = parseSmartCsv(content, FIELD_MAP, 2);
      expect(result.rows[0].nombre).toBe('Router, Dual Band');
    });

    it('ignora líneas en blanco', () => {
      const content = 'Nombre,SKU/Codigo,Categoria\n\nONU A,ONU-1,ONU\n\n';
      const result = parseSmartCsv(content, FIELD_MAP, 2);
      expect(result.rows).toHaveLength(1);
    });

    it('lanza BadRequestException si el archivo está vacío', () => {
      expect(() => parseSmartCsv('', FIELD_MAP, 2)).toThrow(BadRequestException);
      expect(() => parseSmartCsv('   \n  \n', FIELD_MAP, 2)).toThrow(BadRequestException);
    });

    it('lanza BadRequestException si no se reconocen suficientes columnas', () => {
      const content = 'ColumnaA,ColumnaB\nvalor1,valor2';
      expect(() => parseSmartCsv(content, FIELD_MAP, 2)).toThrow(BadRequestException);
      try {
        parseSmartCsv(content, FIELD_MAP, 2);
        fail('debió lanzar');
      } catch (err: any) {
        expect(err.message).toContain('ColumnaA');
        expect(err.message).toContain('0 de 2 mínimas');
      }
    });

    it('celdas faltantes en una fila corta se rellenan con string vacío', () => {
      const content = 'Nombre,SKU/Codigo,Categoria\nSolo Nombre';
      const result = parseSmartCsv(content, FIELD_MAP, 2);
      expect(result.rows[0]).toEqual({ rowNumber: 2, nombre: 'Solo Nombre', sku: '', categoria: '' });
    });
  });

  describe('parseSmartExcel', () => {
    async function buildWorkbookBuffer(headerRow: string[], dataRows: string[][]): Promise<Buffer> {
      const workbook = new Workbook();
      const sheet = workbook.addWorksheet('Hoja1');
      sheet.addRow(headerRow);
      dataRows.forEach((row) => sheet.addRow(row));
      return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    }

    it('reconoce columnas por nombre en un archivo .xlsx real', async () => {
      const buffer = await buildWorkbookBuffer(
        ['SKU/Codigo', 'Nombre', 'Categoria'],
        [
          ['ONU-100', 'ONU GPON XYZ', 'ONU'],
          ['ROU-50', 'Router WiFi 6', 'Router'],
        ],
      );
      const result = await parseSmartExcel(buffer, FIELD_MAP, 2);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({ rowNumber: 2, sku: 'ONU-100', nombre: 'ONU GPON XYZ', categoria: 'ONU' });
    });

    it('ignora filas completamente vacías', async () => {
      const buffer = await buildWorkbookBuffer(
        ['Nombre', 'SKU/Codigo', 'Categoria'],
        [
          ['ONU A', 'ONU-1', 'ONU'],
          ['', '', ''],
        ],
      );
      const result = await parseSmartExcel(buffer, FIELD_MAP, 2);
      expect(result.rows).toHaveLength(1);
    });

    it('lanza BadRequestException si el workbook no tiene hojas con filas', async () => {
      const workbook = new Workbook();
      workbook.addWorksheet('Vacia');
      const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
      await expect(parseSmartExcel(buffer, FIELD_MAP, 2)).rejects.toThrow(BadRequestException);
    });
  });

  describe('parseSmartFile', () => {
    it('despacha a CSV por extensión .csv', async () => {
      const buffer = Buffer.from('Nombre,SKU/Codigo,Categoria\nONU A,ONU-1,ONU', 'utf8');
      const result = await parseSmartFile(buffer, 'productos.csv', FIELD_MAP, 2);
      expect(result.rows[0].nombre).toBe('ONU A');
    });

    it('despacha a Excel por extensión .xlsx', async () => {
      const workbook = new Workbook();
      const sheet = workbook.addWorksheet('Hoja1');
      sheet.addRow(['Nombre', 'SKU/Codigo', 'Categoria']);
      sheet.addRow(['ONU A', 'ONU-1', 'ONU']);
      const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
      const result = await parseSmartFile(buffer, 'productos.xlsx', FIELD_MAP, 2);
      expect(result.rows[0].nombre).toBe('ONU A');
    });

    it('lanza BadRequestException para extensión no soportada', async () => {
      const buffer = Buffer.from('cualquier cosa');
      await expect(parseSmartFile(buffer, 'productos.pdf', FIELD_MAP, 2)).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si no hay extensión', async () => {
      const buffer = Buffer.from('cualquier cosa');
      await expect(parseSmartFile(buffer, 'productos', FIELD_MAP, 2)).rejects.toThrow(BadRequestException);
    });
  });

  describe('parseMoneyAmount', () => {
    it('parsea formato US con separador de miles (coma) y símbolo de moneda', () => {
      expect(parseMoneyAmount('RD$1,600.00')).toBe(1600);
      expect(parseMoneyAmount('$2,500.50')).toBe(2500.5);
    });

    it('parsea formato europeo con separador de miles (punto) y coma decimal', () => {
      expect(parseMoneyAmount('1.600,00')).toBe(1600);
      expect(parseMoneyAmount('2.500,50')).toBe(2500.5);
    });

    it('parsea solo coma decimal (sin separador de miles)', () => {
      expect(parseMoneyAmount('200,00')).toBe(200);
    });

    it('parsea números simples sin separadores', () => {
      expect(parseMoneyAmount('1600')).toBe(1600);
      expect(parseMoneyAmount('0')).toBe(0);
    });

    it('vacío, undefined o null -> 0, nunca lanza', () => {
      expect(parseMoneyAmount('')).toBe(0);
      expect(parseMoneyAmount(undefined)).toBe(0);
      expect(parseMoneyAmount(null)).toBe(0);
    });

    it('texto no numérico -> 0, nunca lanza', () => {
      expect(parseMoneyAmount('no es un numero')).toBe(0);
    });

    it('negativos se tratan como inválidos (0)', () => {
      expect(parseMoneyAmount('-500')).toBe(0);
    });
  });

  describe('parseYesNo', () => {
    it('reconoce variantes afirmativas en español e inglés', () => {
      expect(parseYesNo('Sí')).toBe(true);
      expect(parseYesNo('si')).toBe(true);
      expect(parseYesNo('S')).toBe(true);
      expect(parseYesNo('Yes')).toBe(true);
      expect(parseYesNo('true')).toBe(true);
      expect(parseYesNo('1')).toBe(true);
      expect(parseYesNo('X')).toBe(true);
    });

    it('reconoce variantes negativas', () => {
      expect(parseYesNo('No')).toBe(false);
      expect(parseYesNo('n')).toBe(false);
      expect(parseYesNo('false')).toBe(false);
      expect(parseYesNo('0')).toBe(false);
    });

    it('valor vacío o no reconocido usa el default provisto', () => {
      expect(parseYesNo('', true)).toBe(true);
      expect(parseYesNo(undefined, false)).toBe(false);
      expect(parseYesNo('tal vez', true)).toBe(true);
      expect(parseYesNo('tal vez', false)).toBe(false);
    });
  });
});
