import * as ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { DgiiTestSetImportService } from './dgii-testset-import.service';

/**
 * Construye un .xlsx en memoria que replica la forma real del set de pruebas
 * que la DGII entrega por RNC (hojas "ECF"/"RFCE", columnas por nombre,
 * marcador "#e" para "no aplica") — verificado contra un archivo de ejemplo
 * real (SetPruebas/{RNC}-{fecha}{consecutivo}.xlsx).
 */
async function buildWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const ecfSheet = workbook.addWorksheet('ECF');
  ecfSheet.addRow([
    'CasoPrueba', 'Version', 'TipoeCF', 'ENCF', 'FechaVencimientoSecuencia',
    'IndicadorNotaCredito', 'TipoIngresos', 'TipoPago', 'MontoPago[1]',
    'NCFModificado', 'CodigoModificacion', 'RazonModificacion',
  ]);
  // Caso 1: factura de crédito fiscal (E31) — sin nota que referenciar
  ecfSheet.addRow(['430086762E310000000003', '1.0', '31', 'E310000000003', '31-12-2028', '#e', '01', '1', '7080.00', '#e', '#e', '#e']);
  // Caso 2: nota de crédito (E34) que sí referencia un e-CF base real
  ecfSheet.addRow(['430086762E340000000013', '1.0', '34', 'E340000000013', '#e', '0', '01', '1', '#e', 'E310000000003', '1', 'Anulación por cancelación']);
  // Fila sin ENCF -> debe ignorarse
  ecfSheet.addRow(['sin-encf', '1.0', '32', '', '#e', '#e', '01', '1', '#e', '#e', '#e', '#e']);

  const rfceSheet = workbook.addWorksheet('RFCE');
  rfceSheet.addRow(['CasoPrueba', 'TipoeCF', 'ENCF', 'RNCComprador', 'RazonSocialComprador', 'MontoGravadoTotal', 'MontoExento', 'TotalITBIS', 'MontoTotal']);
  rfceSheet.addRow(['430086762E320000000099', '32', 'E320000000099', '#e', '#e', '3500.00', '0', '630.00', '4130.00']);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

describe('DgiiTestSetImportService', () => {
  let service: DgiiTestSetImportService;

  beforeEach(() => {
    service = new DgiiTestSetImportService();
  });

  it('parsea la hoja ECF mapeando columnas por nombre de encabezado', async () => {
    const buffer = await buildWorkbookBuffer();
    const result = await service.parseWorkbook(buffer);

    expect(result.ecfRows).toHaveLength(2); // la fila sin ENCF se descarta
    expect(result.ecfRows[0]).toMatchObject({
      casoPrueba: '430086762E310000000003',
      tipoeCF: '31',
      eNCF: 'E310000000003',
      fechaVencimientoSecuencia: '31-12-2028',
      tipoPago: '1',
      montoTotal: 7080,
    });
  });

  it('trata "#e" como celda vacía (convención de la DGII para "no aplica")', async () => {
    const buffer = await buildWorkbookBuffer();
    const result = await service.parseWorkbook(buffer);

    expect(result.ecfRows[0].indicadorNotaCredito).toBeUndefined();
    expect(result.ecfRows[0].rncComprador).toBeUndefined();
  });

  it('reconstruye MontoTotal sumando MontoPago[n] cuando la columna MontoTotal no viene poblada', async () => {
    const buffer = await buildWorkbookBuffer();
    const result = await service.parseWorkbook(buffer);

    expect(result.ecfRows[0].montoTotal).toBe(7080);
  });

  it('mapea NCFModificado (nombre real de la columna DGII) a eNCFModificado', async () => {
    const buffer = await buildWorkbookBuffer();
    const result = await service.parseWorkbook(buffer);

    const nota = result.ecfRows.find((r) => r.tipoeCF === '34');
    expect(nota?.eNCFModificado).toBe('E310000000003');
    expect(nota?.codigoModificacion).toBe('1');
    expect(nota?.razonModificacion).toBe('Anulación por cancelación');
  });

  it('parsea la hoja RFCE por separado', async () => {
    const buffer = await buildWorkbookBuffer();
    const result = await service.parseWorkbook(buffer);

    expect(result.rfceRows).toHaveLength(1);
    expect(result.rfceRows[0]).toMatchObject({
      eNCF: 'E320000000099',
      montoTotal: 4130,
      totalITBIS: 630,
    });
  });

  it('lanza BadRequestException si el archivo no tiene hojas ECF ni RFCE', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('OtraHoja');
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer as ArrayBuffer);

    await expect(service.parseWorkbook(buffer)).rejects.toThrow(BadRequestException);
  });

  it('lanza BadRequestException si el buffer no es un .xlsx válido', async () => {
    await expect(service.parseWorkbook(Buffer.from('esto no es un xlsx'))).rejects.toThrow(BadRequestException);
  });
});
