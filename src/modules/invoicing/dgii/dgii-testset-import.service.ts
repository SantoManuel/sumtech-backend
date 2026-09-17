import { Injectable, BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

/**
 * Fila de la hoja "ECF" del set de pruebas que la propia DGII asigna y
 * entrega por RNC para la certificación (se descarga desde su portal, no lo
 * genera sumtech). Solo se extraen los campos que hoy consume el generador
 * de XML (`EcfGenerationInput`); el archivo real trae miles de columnas para
 * datos de encabezado/comprador/ítems que la DGII deja en blanco ("#e") a
 * propósito porque es el emisor quien debe completarlos con contenido real.
 */
export interface DgiiTestSetEcfRow {
  casoPrueba: string;
  tipoeCF: string; // '31'..'47' (numérico, sin el prefijo 'E' del e-NCF)
  eNCF: string;
  fechaVencimientoSecuencia?: string;
  indicadorNotaCredito?: string;
  tipoIngresos?: string;
  tipoPago?: string;
  montoTotal: number;
  rncComprador?: string;
  razonSocialComprador?: string;
  eNCFModificado?: string;
  fechaNCFModificado?: string;
  codigoModificacion?: string;
  razonModificacion?: string;
}

/** Fila de la hoja "RFCE" (Resúmenes de Factura de Consumo Electrónica, < RD$250,000). */
export interface DgiiTestSetRfceRow {
  casoPrueba: string;
  tipoeCF: string;
  eNCF: string;
  rncComprador?: string;
  razonSocialComprador?: string;
  montoGravadoTotal?: number;
  montoExento?: number;
  totalITBIS?: number;
  montoTotal: number;
}

export interface DgiiTestSetImportResult {
  ecfRows: DgiiTestSetEcfRow[];
  rfceRows: DgiiTestSetRfceRow[];
}

/**
 * Valores con los que la propia DGII marca "no aplica" en su plantilla del
 * set de pruebas — no es basura del archivo, es su convención documentada.
 * Confirmado contra un archivo real de ejemplo
 * (SetPruebas/{RNC}-{fecha}{consecutivo}.xlsx) y contra el lector de
 * referencia de un proveedor certificado (TarbiatAdmin.Dgii/Services/
 * TestSetReader.cs:452).
 */
const DGII_EMPTY_MARKERS = new Set(['#e', '#n/a', 'n/a']);

@Injectable()
export class DgiiTestSetImportService {
  /**
   * Parsea el .xlsx oficial de la DGII (hojas "ECF" y "RFCE") a partir de su
   * buffer. Mapea columnas por NOMBRE de encabezado, nunca por posición: el
   * archivo real trae miles de columnas (grupos repetidos NombreItem[k],
   * MontoItem[k], etc.) y su orden no está garantizado entre certificaciones.
   */
  async parseWorkbook(buffer: Buffer): Promise<DgiiTestSetImportResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch (err: any) {
      throw new BadRequestException(`No se pudo leer el archivo .xlsx: ${err.message}`);
    }

    const ecfSheet = this.findSheet(workbook, 'ECF');
    const rfceSheet = this.findSheet(workbook, 'RFCE');

    if (!ecfSheet && !rfceSheet) {
      throw new BadRequestException(
        'El archivo no tiene ninguna hoja "ECF" ni "RFCE" — no parece ser el set de pruebas oficial de la DGII.',
      );
    }

    return {
      ecfRows: ecfSheet ? this.parseEcfSheet(ecfSheet) : [],
      rfceRows: rfceSheet ? this.parseRfceSheet(rfceSheet) : [],
    };
  }

  private findSheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
    return workbook.worksheets.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
  }

  /** Construye el mapa "nombre de encabezado" -> índice de columna (fila 1). */
  private buildHeaderMap(sheet: ExcelJS.Worksheet): Map<string, number> {
    const map = new Map<string, number>();
    const headerRow = sheet.getRow(1);
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const name = String(cell.value ?? '').trim();
      if (name && !map.has(name)) {
        map.set(name, colNumber);
      }
    });
    return map;
  }

  /** Lee una celda por nombre de columna; trata los marcadores "vacío" de la DGII como string vacío. */
  private getStr(row: ExcelJS.Row, headerMap: Map<string, number>, name: string): string {
    const col = headerMap.get(name);
    if (!col) return '';
    const raw = row.getCell(col).value;
    if (raw === null || raw === undefined) return '';
    const value = typeof raw === 'object' && raw && 'result' in (raw as any) ? String((raw as any).result) : String(raw);
    const trimmed = value.trim();
    if (DGII_EMPTY_MARKERS.has(trimmed.toLowerCase())) return '';
    return trimmed;
  }

  private getDec(row: ExcelJS.Row, headerMap: Map<string, number>, name: string): number {
    const str = this.getStr(row, headerMap, name);
    if (!str) return 0;
    const normalized = str.replace(/,/g, '');
    const num = Number(normalized);
    return Number.isFinite(num) ? num : 0;
  }

  private parseEcfSheet(sheet: ExcelJS.Worksheet): DgiiTestSetEcfRow[] {
    const headerMap = this.buildHeaderMap(sheet);
    const rows: DgiiTestSetEcfRow[] = [];

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const eNCF = this.getStr(row, headerMap, 'ENCF');
      if (!eNCF) continue;

      // MontoTotal no siempre viene poblado en el archivo (columna de totales
      // agregados); cuando falta, se reconstruye sumando FormaPago[n]/MontoPago[n]
      // (hasta 4 formas de pago por caso, igual que TestSetReader.cs).
      let montoTotal = this.getDec(row, headerMap, 'MontoTotal');
      if (montoTotal <= 0) {
        for (let p = 1; p <= 4; p++) {
          montoTotal += this.getDec(row, headerMap, `MontoPago[${p}]`);
        }
      }

      rows.push({
        casoPrueba: this.getStr(row, headerMap, 'CasoPrueba'),
        tipoeCF: this.getStr(row, headerMap, 'TipoeCF'),
        eNCF,
        fechaVencimientoSecuencia: this.getStr(row, headerMap, 'FechaVencimientoSecuencia') || undefined,
        indicadorNotaCredito: this.getStr(row, headerMap, 'IndicadorNotaCredito') || undefined,
        tipoIngresos: this.getStr(row, headerMap, 'TipoIngresos') || undefined,
        tipoPago: this.getStr(row, headerMap, 'TipoPago') || undefined,
        montoTotal,
        rncComprador: this.getStr(row, headerMap, 'RNCComprador') || undefined,
        razonSocialComprador: this.getStr(row, headerMap, 'RazonSocialComprador') || undefined,
        // La columna oficial se llama "NCFModificado"; se acepta también
        // "eNCFModificado" por si una versión futura del archivo la renombra.
        eNCFModificado:
          this.getStr(row, headerMap, 'NCFModificado') || this.getStr(row, headerMap, 'eNCFModificado') || undefined,
        fechaNCFModificado: this.getStr(row, headerMap, 'FechaNCFModificado') || undefined,
        codigoModificacion: this.getStr(row, headerMap, 'CodigoModificacion') || undefined,
        razonModificacion: this.getStr(row, headerMap, 'RazonModificacion') || undefined,
      });
    }

    return rows;
  }

  private parseRfceSheet(sheet: ExcelJS.Worksheet): DgiiTestSetRfceRow[] {
    const headerMap = this.buildHeaderMap(sheet);
    const rows: DgiiTestSetRfceRow[] = [];

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const eNCF = this.getStr(row, headerMap, 'ENCF');
      if (!eNCF) continue;

      rows.push({
        casoPrueba: this.getStr(row, headerMap, 'CasoPrueba'),
        tipoeCF: this.getStr(row, headerMap, 'TipoeCF'),
        eNCF,
        rncComprador: this.getStr(row, headerMap, 'RNCComprador') || undefined,
        razonSocialComprador: this.getStr(row, headerMap, 'RazonSocialComprador') || undefined,
        montoGravadoTotal: this.getDec(row, headerMap, 'MontoGravadoTotal') || undefined,
        montoExento: this.getDec(row, headerMap, 'MontoExento') || undefined,
        totalITBIS: this.getDec(row, headerMap, 'TotalITBIS') || undefined,
        montoTotal: this.getDec(row, headerMap, 'MontoTotal'),
      });
    }

    return rows;
  }
}
