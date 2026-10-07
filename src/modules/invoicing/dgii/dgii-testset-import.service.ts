import { Injectable, BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

export interface DgiiTestSetSubDescuento {
  tipo: string;
  porcentaje?: string;
  monto?: string;
}

export interface DgiiTestSetSubRecargo {
  tipo: string;
  porcentaje?: string;
  monto?: string;
}

export interface DgiiTestSetImpuestoAdicional {
  tipoImpuesto: string;
  tasa?: string;
  montoEspecifico?: string;
  montoAdvalorem?: string;
  otrosImpuestos?: string;
}

export interface DgiiTestSetSubcantidad {
  subcantidad?: string;
  codigoSubcantidad?: string;
}

export interface DgiiTestSetInformacionesAdicionales {
  fechaEmbarque?: string;
  numeroEmbarque?: string;
  numeroContenedor?: string;
  numeroReferencia?: string;
  pesoBruto?: string;
  pesoNeto?: string;
  unidadPesoBruto?: string;
  unidadPesoNeto?: string;
  cantidadBulto?: string;
  unidadBulto?: string;
  volumenBulto?: string;
  unidadVolumen?: string;
}

export interface DgiiTestSetDescuentoORecargo {
  numeroLinea: number;
  tipoAjuste: string;
  indicadorNorma1007?: string;
  descripcion?: string;
  tipoValor?: string;
  valor?: string;
  monto?: string;
  montoOtraMoneda?: string;
  indicadorFacturacion?: string;
}

export interface DgiiTestSetItemDetail {
  numeroLinea: number;
  nombreItem: string;
  indicadorFacturacion: string; // '1' | '2' | '3' | '4'
  indicadorBienoServicio?: string; // '1' = Bien, '2' = Servicio
  descripcionItem?: string;
  cantidadItem: number;
  cantidadItemStr?: string;
  unidadMedida?: number;
  cantidadReferenciaStr?: string;
  unidadReferenciaStr?: string;
  subcantidades?: DgiiTestSetSubcantidad[];
  gradosAlcoholStr?: string;
  precioUnitarioReferenciaStr?: string;
  fechaElaboracion?: string;
  fechaVencimientoItem?: string;
  precioUnitarioItem: number;
  precioUnitarioItemStr?: string;
  descuentoMonto?: number;
  descuentoMontoStr?: string;
  subDescuentos?: DgiiTestSetSubDescuento[];
  recargoMonto?: number;
  recargoMontoStr?: string;
  subRecargos?: DgiiTestSetSubRecargo[];
  impuestosAdicionalesCodigos?: string[];
  montoItem: number;
  montoItemStr?: string;
  montoITBISRetenido?: number;
  montoISRRetenido?: number;
  indicadorAgenteRetencionoPercepcion?: string;
}

/**
 * Fila de la hoja "ECF" del set de pruebas que la propia DGII asigna y
 * entrega por RNC para la certificación (se descarga desde su portal, no lo
 * genera sumtech).
 */
export interface DgiiTestSetEcfRow {
  casoPrueba: string;
  tipoeCF: string; // '31'..'47' (numérico, sin el prefijo 'E' del e-NCF)
  eNCF: string;
  fechaVencimientoSecuencia?: string;
  indicadorNotaCredito?: string;
  indicadorEnvioDiferido?: string;
  indicadorMontoGravado?: string;
  tipoIngresos?: string;
  tipoPago?: string;
  terminoPago?: string;
  numeroReferencia?: string;
  montoTotal: number;
  montoTotalStr?: string;

  // Emisor prescrito por la DGII
  rncEmisor?: string;
  razonSocialEmisor?: string;
  nombreComercial?: string;
  direccionEmisor?: string;
  municipio?: string;
  provincia?: string;
  telefonosEmisor?: string[];
  correoEmisor?: string;
  webSite?: string;
  fechaEmision?: string; // dd-MM-yyyy
  codigoVendedor?: string;
  numeroFacturaInterna?: string;
  numeroPedidoInterno?: string;
  zonaVenta?: string;

  // Comprador prescrito por la DGII
  rncComprador?: string;
  identificadorExtranjero?: string;
  razonSocialComprador?: string;
  contactoComprador?: string;
  correoComprador?: string;
  direccionComprador?: string;
  municipioComprador?: string;
  provinciaComprador?: string;
  telefonoAdicional?: string;
  fechaEntrega?: string;
  fechaOrdenCompra?: string;
  numeroOrdenCompra?: string;
  codigoInternoComprador?: string;

  // Totales prescritos por la DGII
  montoGravadoTotal?: number;
  montoGravadoTotalStr?: string;
  montoGravadoI1?: number;
  montoGravadoI1Str?: string;
  montoGravadoI2?: number;
  montoGravadoI2Str?: string;
  montoGravadoI3?: number;
  montoGravadoI3Str?: string;
  montoExento?: number;
  montoExentoStr?: string;
  itbis1?: string;
  itbis2?: string;
  itbis3?: string;
  totalITBIS?: number;
  totalITBISStr?: string;
  totalITBIS1?: number;
  totalITBIS1Str?: string;
  totalITBIS2?: number;
  totalITBIS2Str?: string;
  totalITBIS3?: number;
  totalITBIS3Str?: string;
  totalITBISRetenido?: number;
  totalISRRetencion?: number;
  montoImpuestoAdicional?: number;
  montoImpuestoAdicionalStr?: string;
  impuestosAdicionales?: DgiiTestSetImpuestoAdicional[];
  montoNoFacturable?: number;
  montoPeriodo?: number;
  valorPagar?: number;

  // Modificación (para notas E33/E34)
  eNCFModificado?: string;
  fechaNCFModificado?: string;
  codigoModificacion?: string;
  razonModificacion?: string;

  // Informaciones Adicionales y Transporte
  informacionesAdicionales?: DgiiTestSetInformacionesAdicionales;

  // Descuentos o Recargos Globales
  descuentosORecargos?: DgiiTestSetDescuentoORecargo[];

  // Detalle de ítems
  items?: DgiiTestSetItemDetail[];
}

/** Fila de la hoja "RFCE" (Resúmenes de Factura de Consumo Electrónica, < RD$250,000). */
export interface DgiiTestSetRfceRow {
  casoPrueba: string;
  tipoeCF: string;
  eNCF: string;
  rncEmisor?: string;
  razonSocialEmisor?: string;
  fechaEmision?: string;
  rncComprador?: string;
  razonSocialComprador?: string;
  montoGravadoTotal?: number;
  montoGravadoI1?: number;
  montoExento?: number;
  totalITBIS?: number;
  totalITBIS1?: number;
  montoTotal: number;
}

export interface DgiiTestSetImportResult {
  ecfRows: DgiiTestSetEcfRow[];
  rfceRows: DgiiTestSetRfceRow[];
}

/**
 * Fila de la hoja "ACEECF_Generadas" del set de pruebas para el Paso 3
 * (Aprobaciones Comerciales).
 */
export interface DgiiTestSetAcecfRow {
  id: string;
  casoNumero: number;
  version: string;
  rncEmisor: string;
  eNcf: string;
  tipoeCF: string;
  fechaEmision: string;
  montoTotal: number;
  rncComprador: string;
  estado: 1 | 2;
  detalleMotivoRechazo?: string;
  fechaHoraAprobacionComercial?: string;
  status?: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'ERROR';
  trackId?: string;
  responseMessage?: string;
  signedXml?: string;
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
      if (name) {
        if (!map.has(name)) map.set(name, colNumber);
        if (!map.has(name.toLowerCase())) map.set(name.toLowerCase(), colNumber);
      }
    });
    return map;
  }

  /** Lee una celda por nombre de columna; trata los marcadores "vacío" de la DGII como string vacío. */
  private getStr(row: ExcelJS.Row, headerMap: Map<string, number>, name: string): string {
    const col = headerMap.get(name) ?? headerMap.get(name.toLowerCase());
    if (!col) return '';
    const raw = row.getCell(col).value;
    if (raw === null || raw === undefined) return '';
    const value = typeof raw === 'object' && raw && 'result' in (raw as any) ? String((raw as any).result) : String(raw);
    const trimmed = value.trim();
    if (DGII_EMPTY_MARKERS.has(trimmed.toLowerCase())) return '';
    return trimmed;
  }

  private getDec(row: ExcelJS.Row, headerMap: Map<string, number>, name: string): number | undefined {
    const str = this.getStr(row, headerMap, name);
    if (!str) return undefined;
    const normalized = str.replace(/,/g, '');
    const num = Number(normalized);
    return Number.isFinite(num) ? num : undefined;
  }

  private parseEcfSheet(sheet: ExcelJS.Worksheet): DgiiTestSetEcfRow[] {
    const headerMap = this.buildHeaderMap(sheet);
    const rows: DgiiTestSetEcfRow[] = [];

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const eNCF = this.getStr(row, headerMap, 'ENCF');
      if (!eNCF) continue;

      let montoTotal = this.getDec(row, headerMap, 'MontoTotal') ?? 0;
      if (montoTotal <= 0) {
        for (let p = 1; p <= 4; p++) {
          montoTotal += this.getDec(row, headerMap, `MontoPago[${p}]`) ?? 0;
        }
      }

      // Parsear telefonos emisor
      const telefonosEmisor: string[] = [];
      for (let t = 1; t <= 5; t++) {
        let tel = this.getStr(row, headerMap, `TelefonoEmisor[${t}]`);
        if (!tel && t === 1) tel = this.getStr(row, headerMap, 'TelefonoEmisor');
        if (tel) telefonosEmisor.push(tel);
      }

      // Parsear ítems detallados prescritos por la DGII
      const items: DgiiTestSetItemDetail[] = [];
      for (let k = 1; k <= 80; k++) {
        const nombreItem = this.getStr(row, headerMap, `NombreItem[${k}]`) || this.getStr(row, headerMap, `NombreItem[${k}][1]`);
        if (!nombreItem) continue;

        const indFact = this.getStr(row, headerMap, `IndicadorFacturacion[${k}]`) || this.getStr(row, headerMap, 'IndicadorFacturacion') || '1';
        const indBienServ = this.getStr(row, headerMap, `IndicadorBienoServicio[${k}]`) || '1';
        const cant = this.getDec(row, headerMap, `CantidadItem[${k}]`) ?? 1;
        const cantStr = this.getStr(row, headerMap, `CantidadItem[${k}]`);
        const precio = this.getDec(row, headerMap, `PrecioUnitarioItem[${k}]`) ?? 0;
        const precioStr = this.getStr(row, headerMap, `PrecioUnitarioItem[${k}]`);
        const descMonto = this.getDec(row, headerMap, `DescuentoMonto[${k}]`);
        const descMontoStr = this.getStr(row, headerMap, `DescuentoMonto[${k}]`);
        const recargoMonto = this.getDec(row, headerMap, `RecargoMonto[${k}]`);
        const recargoMontoStr = this.getStr(row, headerMap, `RecargoMonto[${k}]`);
        let monto = this.getDec(row, headerMap, `MontoItem[${k}]`);
        const montoStr = this.getStr(row, headerMap, `MontoItem[${k}]`);
        if (monto === undefined && cant > 0 && precio > 0) {
          monto = Number(((cant * precio) - (descMonto || 0) + (recargoMonto || 0)).toFixed(2));
        }

        const itbisRet = this.getDec(row, headerMap, `MontoITBISRetenido[${k}]`);
        const isrRet = this.getDec(row, headerMap, `MontoISRRetenido[${k}]`);
        const indAgente = this.getStr(row, headerMap, `IndicadorAgenteRetencionoPercepcion[${k}]`) || (itbisRet || isrRet ? '1' : undefined);
        const umStr = this.getStr(row, headerMap, `UnidadMedida[${k}]`);
        const um = umStr ? parseInt(umStr, 10) : undefined;
        const descItem = this.getStr(row, headerMap, `DescripcionItem[${k}]`);

        // SubDescuentos por línea de ítem
        const subDescuentos: DgiiTestSetSubDescuento[] = [];
        for (let s = 1; s <= 5; s++) {
          const tipoSub = this.getStr(row, headerMap, `TipoSubDescuento[${k}][${s}]`);
          if (tipoSub) {
            subDescuentos.push({
              tipo: tipoSub,
              porcentaje: this.getStr(row, headerMap, `SubDescuentoPorcentaje[${k}][${s}]`) || undefined,
              monto: this.getStr(row, headerMap, `MontoSubDescuento[${k}][${s}]`) || undefined,
            });
          }
        }

        // SubRecargos por línea de ítem
        const subRecargos: DgiiTestSetSubRecargo[] = [];
        for (let s = 1; s <= 5; s++) {
          const tipoSub = this.getStr(row, headerMap, `TipoSubRecargo[${k}][${s}]`);
          if (tipoSub) {
            subRecargos.push({
              tipo: tipoSub,
              porcentaje: this.getStr(row, headerMap, `SubRecargoPorcentaje[${k}][${s}]`) || undefined,
              monto: this.getStr(row, headerMap, `MontosubRecargo[${k}][${s}]`) || undefined,
            });
          }
        }

        // Subcantidades por línea de ítem
        const subcantidades: DgiiTestSetSubcantidad[] = [];
        for (let s = 1; s <= 5; s++) {
          const subc = this.getStr(row, headerMap, `Subcantidad[${k}][${s}]`);
          const codSubc = this.getStr(row, headerMap, `CodigoSubcantidad[${k}][${s}]`);
          if (subc || codSubc) {
            subcantidades.push({
              subcantidad: subc || undefined,
              codigoSubcantidad: codSubc || undefined,
            });
          }
        }

        // Impuestos adicionales aplicados al ítem
        const impuestosAdicionalesCodigos: string[] = [];
        for (let s = 1; s <= 3; s++) {
          const cod = this.getStr(row, headerMap, `TipoImpuesto[${k}][${s}]`);
          if (cod) impuestosAdicionalesCodigos.push(cod);
        }

        items.push({
          numeroLinea: items.length + 1,
          nombreItem,
          indicadorFacturacion: indFact,
          indicadorBienoServicio: indBienServ,
          descripcionItem: descItem || undefined,
          cantidadItem: cant,
          cantidadItemStr: cantStr || undefined,
          unidadMedida: Number.isFinite(um) ? um : undefined,
          cantidadReferenciaStr: this.getStr(row, headerMap, `CantidadReferencia[${k}]`) || undefined,
          unidadReferenciaStr: this.getStr(row, headerMap, `UnidadReferencia[${k}]`) || undefined,
          subcantidades: subcantidades.length > 0 ? subcantidades : undefined,
          gradosAlcoholStr: this.getStr(row, headerMap, `GradosAlcohol[${k}]`) || undefined,
          precioUnitarioReferenciaStr: this.getStr(row, headerMap, `PrecioUnitarioReferencia[${k}]`) || undefined,
          fechaElaboracion: this.getStr(row, headerMap, `FechaElaboracion[${k}]`) || undefined,
          fechaVencimientoItem: this.getStr(row, headerMap, `FechaVencimientoItem[${k}]`) || undefined,
          precioUnitarioItem: precio,
          precioUnitarioItemStr: precioStr || undefined,
          descuentoMonto: descMonto,
          descuentoMontoStr: descMontoStr || undefined,
          subDescuentos: subDescuentos.length > 0 ? subDescuentos : undefined,
          recargoMonto: recargoMonto,
          recargoMontoStr: recargoMontoStr || undefined,
          subRecargos: subRecargos.length > 0 ? subRecargos : undefined,
          impuestosAdicionalesCodigos: impuestosAdicionalesCodigos.length > 0 ? impuestosAdicionalesCodigos : undefined,
          montoItem: monto ?? 0,
          montoItemStr: montoStr || undefined,
          montoITBISRetenido: itbisRet,
          montoISRRetenido: isrRet,
          indicadorAgenteRetencionoPercepcion: indAgente,
        });
      }

      // Impuestos adicionales a nivel de Totales
      const impuestosAdicionalesTotales: DgiiTestSetImpuestoAdicional[] = [];
      for (let p = 1; p <= 4; p++) {
        const tipoImp = this.getStr(row, headerMap, `TipoImpuesto[${p}]`);
        if (tipoImp) {
          impuestosAdicionalesTotales.push({
            tipoImpuesto: tipoImp,
            tasa: this.getStr(row, headerMap, `TasaImpuestoAdicional[${p}]`) || undefined,
            montoEspecifico: this.getStr(row, headerMap, `MontoImpuestoSelectivoConsumoEspecifico[${p}]`) || undefined,
            montoAdvalorem: this.getStr(row, headerMap, `MontoImpuestoSelectivoConsumoAdvalorem[${p}]`) || undefined,
            otrosImpuestos: this.getStr(row, headerMap, `OtrosImpuestosAdicionales[${p}]`) || undefined,
          });
        }
      }

      // Descuentos o Recargos Globales
      const descuentosORecargos: DgiiTestSetDescuentoORecargo[] = [];
      for (let d = 1; d <= 20; d++) {
        const numLinea = this.getStr(row, headerMap, `NumeroLineaDoR[${d}]`);
        const tipoAjuste = this.getStr(row, headerMap, `TipoAjuste[${d}]`);
        if (numLinea && tipoAjuste) {
          descuentosORecargos.push({
            numeroLinea: parseInt(numLinea, 10),
            tipoAjuste,
            indicadorNorma1007: this.getStr(row, headerMap, `IndicadorNorma1007[${d}]`) || undefined,
            descripcion: this.getStr(row, headerMap, `DescripcionDescuentooRecargo[${d}]`) || undefined,
            tipoValor: this.getStr(row, headerMap, `TipoValor[${d}]`) || undefined,
            valor: this.getStr(row, headerMap, `ValorDescuentooRecargo[${d}]`) || undefined,
            monto: this.getStr(row, headerMap, `MontoDescuentooRecargo[${d}]`) || undefined,
            montoOtraMoneda: this.getStr(row, headerMap, `MontoDescuentooRecargoOtraMoneda[${d}]`) || undefined,
            indicadorFacturacion: this.getStr(row, headerMap, `IndicadorFacturacionDescuentooRecargo[${d}]`) || undefined,
          });
        }
      }

      // Informaciones Adicionales
      const fEmbarque = this.getStr(row, headerMap, 'FechaEmbarque');
      const nEmbarque = this.getStr(row, headerMap, 'NumeroEmbarque');
      const nContenedor = this.getStr(row, headerMap, 'NumeroContenedor');
      const nRef = this.getStr(row, headerMap, 'NumeroReferencia');
      const pBruto = this.getStr(row, headerMap, 'PesoBruto');
      const pNeto = this.getStr(row, headerMap, 'PesoNeto');
      const uPesoBruto = this.getStr(row, headerMap, 'UnidadPesoBruto');
      const uPesoNeto = this.getStr(row, headerMap, 'UnidadPesoNeto');
      const cBulto = this.getStr(row, headerMap, 'CantidadBulto');
      const uBulto = this.getStr(row, headerMap, 'UnidadBulto');
      const vBulto = this.getStr(row, headerMap, 'VolumenBulto');
      const uVolumen = this.getStr(row, headerMap, 'UnidadVolumen');

      const tieneInfoAdic = !!(fEmbarque || nEmbarque || nContenedor || nRef || pBruto || pNeto || uPesoBruto || uPesoNeto || cBulto || uBulto || vBulto || uVolumen);

      rows.push({
        casoPrueba: this.getStr(row, headerMap, 'CasoPrueba'),
        tipoeCF: this.getStr(row, headerMap, 'TipoeCF'),
        eNCF,
        fechaVencimientoSecuencia: this.getStr(row, headerMap, 'FechaVencimientoSecuencia') || undefined,
        indicadorNotaCredito: this.getStr(row, headerMap, 'IndicadorNotaCredito') || undefined,
        indicadorEnvioDiferido: this.getStr(row, headerMap, 'IndicadorEnvioDiferido') || undefined,
        indicadorMontoGravado: this.getStr(row, headerMap, 'IndicadorMontoGravado') || undefined,
        tipoIngresos: this.getStr(row, headerMap, 'TipoIngresos'),
        tipoPago: this.getStr(row, headerMap, 'TipoPago'),
        terminoPago: this.getStr(row, headerMap, 'TerminoPago') || undefined,
        numeroReferencia: this.getStr(row, headerMap, 'NumeroReferencia') || undefined,
        montoTotal,
        montoTotalStr: this.getStr(row, headerMap, 'MontoTotal') || undefined,

        // Emisor
        rncEmisor: this.getStr(row, headerMap, 'RNCEmisor') || undefined,
        razonSocialEmisor: this.getStr(row, headerMap, 'RazonSocialEmisor') || undefined,
        nombreComercial: this.getStr(row, headerMap, 'NombreComercial'),
        direccionEmisor: this.getStr(row, headerMap, 'DireccionEmisor') || undefined,
        municipio: this.getStr(row, headerMap, 'Municipio') || undefined,
        provincia: this.getStr(row, headerMap, 'Provincia') || undefined,
        telefonosEmisor: telefonosEmisor.length > 0 ? telefonosEmisor : undefined,
        correoEmisor: this.getStr(row, headerMap, 'CorreoEmisor') || undefined,
        webSite: this.getStr(row, headerMap, 'WebSite') || undefined,
        fechaEmision: this.getStr(row, headerMap, 'FechaEmision') || undefined,
        codigoVendedor: this.getStr(row, headerMap, 'CodigoVendedor') || undefined,
        numeroFacturaInterna: this.getStr(row, headerMap, 'NumeroFacturaInterna') || undefined,
        numeroPedidoInterno: this.getStr(row, headerMap, 'NumeroPedidoInterno') || undefined,
        zonaVenta: this.getStr(row, headerMap, 'ZonaVenta') || undefined,

        // Comprador
        rncComprador: this.getStr(row, headerMap, 'RNCComprador') || undefined,
        identificadorExtranjero: this.getStr(row, headerMap, 'IdentificadorExtranjero') || undefined,
        razonSocialComprador: this.getStr(row, headerMap, 'RazonSocialComprador') || undefined,
        contactoComprador: this.getStr(row, headerMap, 'ContactoComprador') || undefined,
        correoComprador: this.getStr(row, headerMap, 'CorreoComprador') || undefined,
        direccionComprador: this.getStr(row, headerMap, 'DireccionComprador') || undefined,
        municipioComprador: this.getStr(row, headerMap, 'MunicipioComprador') || undefined,
        provinciaComprador: this.getStr(row, headerMap, 'ProvinciaComprador') || undefined,
        telefonoAdicional: this.getStr(row, headerMap, 'TelefonoAdicional') || undefined,
        fechaEntrega: this.getStr(row, headerMap, 'FechaEntrega') || undefined,
        fechaOrdenCompra: this.getStr(row, headerMap, 'FechaOrdenCompra') || undefined,
        numeroOrdenCompra: this.getStr(row, headerMap, 'NumeroOrdenCompra') || undefined,
        codigoInternoComprador: this.getStr(row, headerMap, 'CodigoInternoComprador') || undefined,

        // Totales
        montoGravadoTotal: this.getDec(row, headerMap, 'MontoGravadoTotal'),
        montoGravadoTotalStr: this.getStr(row, headerMap, 'MontoGravadoTotal') || undefined,
        montoGravadoI1: this.getDec(row, headerMap, 'MontoGravadoI1'),
        montoGravadoI1Str: this.getStr(row, headerMap, 'MontoGravadoI1') || undefined,
        montoGravadoI2: this.getDec(row, headerMap, 'MontoGravadoI2'),
        montoGravadoI2Str: this.getStr(row, headerMap, 'MontoGravadoI2') || undefined,
        montoGravadoI3: this.getDec(row, headerMap, 'MontoGravadoI3'),
        montoGravadoI3Str: this.getStr(row, headerMap, 'MontoGravadoI3') || undefined,
        montoExento: this.getDec(row, headerMap, 'MontoExento'),
        montoExentoStr: this.getStr(row, headerMap, 'MontoExento') || undefined,
        itbis1: this.getStr(row, headerMap, 'ITBIS1') || undefined,
        itbis2: this.getStr(row, headerMap, 'ITBIS2') || undefined,
        itbis3: this.getStr(row, headerMap, 'ITBIS3') || undefined,
        totalITBIS: this.getDec(row, headerMap, 'TotalITBIS'),
        totalITBISStr: this.getStr(row, headerMap, 'TotalITBIS') || undefined,
        totalITBIS1: this.getDec(row, headerMap, 'TotalITBIS1'),
        totalITBIS1Str: this.getStr(row, headerMap, 'TotalITBIS1') || undefined,
        totalITBIS2: this.getDec(row, headerMap, 'TotalITBIS2'),
        totalITBIS2Str: this.getStr(row, headerMap, 'TotalITBIS2') || undefined,
        totalITBIS3: this.getDec(row, headerMap, 'TotalITBIS3'),
        totalITBIS3Str: this.getStr(row, headerMap, 'TotalITBIS3') || undefined,
        totalITBISRetenido: this.getDec(row, headerMap, 'TotalITBISRetenido'),
        totalISRRetencion: this.getDec(row, headerMap, 'TotalISRRetencion'),
        montoImpuestoAdicional: this.getDec(row, headerMap, 'MontoImpuestoAdicional'),
        montoImpuestoAdicionalStr: this.getStr(row, headerMap, 'MontoImpuestoAdicional') || undefined,
        impuestosAdicionales: impuestosAdicionalesTotales.length > 0 ? impuestosAdicionalesTotales : undefined,
        montoNoFacturable: this.getDec(row, headerMap, 'MontoNoFacturable'),
        montoPeriodo: this.getDec(row, headerMap, 'MontoPeriodo'),
        valorPagar: this.getDec(row, headerMap, 'ValorPagar'),

        // Modificación
        eNCFModificado:
          this.getStr(row, headerMap, 'NCFModificado') || this.getStr(row, headerMap, 'eNCFModificado') || undefined,
        fechaNCFModificado: this.getStr(row, headerMap, 'FechaNCFModificado') || undefined,
        codigoModificacion: this.getStr(row, headerMap, 'CodigoModificacion') || undefined,
        razonModificacion: this.getStr(row, headerMap, 'RazonModificacion'),

        // Informaciones Adicionales y Transporte
        informacionesAdicionales: tieneInfoAdic
          ? {
              fechaEmbarque: fEmbarque || undefined,
              numeroEmbarque: nEmbarque || undefined,
              numeroContenedor: nContenedor || undefined,
              numeroReferencia: nRef || undefined,
              pesoBruto: pBruto || undefined,
              pesoNeto: pNeto || undefined,
              unidadPesoBruto: uPesoBruto || undefined,
              unidadPesoNeto: uPesoNeto || undefined,
              cantidadBulto: cBulto || undefined,
              unidadBulto: uBulto || undefined,
              volumenBulto: vBulto || undefined,
              unidadVolumen: uVolumen || undefined,
            }
          : undefined,

        // Descuentos o Recargos Globales
        descuentosORecargos: descuentosORecargos.length > 0 ? descuentosORecargos : undefined,

        // Detalle de ítems
        items: items.length > 0 ? items : undefined,
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
        rncEmisor: this.getStr(row, headerMap, 'RNCEmisor') || undefined,
        razonSocialEmisor: this.getStr(row, headerMap, 'RazonSocialEmisor') || undefined,
        fechaEmision: this.getStr(row, headerMap, 'FechaEmision') || undefined,
        rncComprador: this.getStr(row, headerMap, 'RNCComprador') || undefined,
        razonSocialComprador: this.getStr(row, headerMap, 'RazonSocialComprador') || undefined,
        montoGravadoTotal: this.getDec(row, headerMap, 'MontoGravadoTotal') || undefined,
        montoGravadoI1: this.getDec(row, headerMap, 'MontoGravadoI1') || undefined,
        montoExento: this.getDec(row, headerMap, 'MontoExento') || undefined,
        totalITBIS: this.getDec(row, headerMap, 'TotalITBIS') || undefined,
        totalITBIS1: this.getDec(row, headerMap, 'TotalITBIS1') || undefined,
        montoTotal: this.getDec(row, headerMap, 'MontoTotal') ?? 0,
      });
    }

    return rows;
  }

  /**
   * Parsea el .xlsx oficial de Aprobaciones Comerciales (Paso 3 DGII, hoja "ACEECF_Generadas").
   */
  async parseAcecfWorkbook(buffer: Buffer): Promise<DgiiTestSetAcecfRow[]> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch (err: any) {
      throw new BadRequestException(`No se pudo leer el archivo .xlsx: ${err.message}`);
    }

    let sheet =
      this.findSheet(workbook, 'ACEECF_Generadas') ||
      this.findSheet(workbook, 'ACEECF') ||
      this.findSheet(workbook, 'ACECF') ||
      this.findSheet(workbook, 'Hoja1');

    if (!sheet && workbook.worksheets.length > 0) {
      sheet = workbook.worksheets[0];
    }

    if (!sheet) {
      throw new BadRequestException('El archivo Excel no contiene hojas de datos.');
    }

    const rows = this.parseAcecfSheet(sheet);
    if (rows.length === 0) {
      throw new BadRequestException('No se encontraron registros de Aprobaciones Comerciales válidos en el archivo Excel.');
    }
    return rows;
  }

  private parseAcecfSheet(sheet: ExcelJS.Worksheet): DgiiTestSetAcecfRow[] {
    const headerMap = this.buildHeaderMap(sheet);
    const rows: DgiiTestSetAcecfRow[] = [];

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const eNCF = this.getStr(row, headerMap, 'eNCF') || this.getStr(row, headerMap, 'ENCF');
      if (!eNCF) continue;

      const rncEmisor = this.getStr(row, headerMap, 'RNCEmisor');
      const rncComprador = this.getStr(row, headerMap, 'RNCComprador');
      const fechaEmision = this.getDateStr(row, headerMap, 'FechaEmision');
      const montoTotal = this.getDec(row, headerMap, 'MontoTotal') ?? 0;
      const estadoStr = this.getStr(row, headerMap, 'Estado');
      const estadoNum = parseInt(estadoStr, 10);
      const estado: 1 | 2 = estadoNum === 2 ? 2 : 1;
      const detalleMotivoRechazo = this.getStr(row, headerMap, 'DetalleMotivoRechazo') || undefined;
      const fechaHoraAprobacionComercial = this.getDateTimeStr(row, headerMap, 'FechaHoraAprobacionComercial') || undefined;
      const version = this.getStr(row, headerMap, 'Version') || '1.0';

      // Derivar tipo e-CF a partir del e-NCF (ej: E310000000001 -> 31)
      const tipoeCF = eNCF.startsWith('E') ? eNCF.substring(1, 3) : eNCF.substring(0, 2);

      rows.push({
        id: `acecf-${r - 1}-${eNCF.trim()}`,
        casoNumero: r - 1,
        version,
        rncEmisor,
        eNcf: eNCF.trim(),
        tipoeCF,
        fechaEmision,
        montoTotal,
        rncComprador,
        estado,
        detalleMotivoRechazo,
        fechaHoraAprobacionComercial,
        status: 'PENDING',
      });
    }

    return rows;
  }

  private getDateStr(row: ExcelJS.Row, headerMap: Map<string, number>, name: string): string {
    const col = headerMap.get(name) ?? headerMap.get(name.toLowerCase());
    if (!col) return '';
    const raw = row.getCell(col).value;
    if (raw === null || raw === undefined) return '';
    if (raw instanceof Date && !isNaN(raw.getTime())) {
      const d = String(raw.getDate()).padStart(2, '0');
      const m = String(raw.getMonth() + 1).padStart(2, '0');
      const y = raw.getFullYear();
      return `${d}-${m}-${y}`;
    }
    return String(raw).trim();
  }

  private getDateTimeStr(row: ExcelJS.Row, headerMap: Map<string, number>, name: string): string {
    const col = headerMap.get(name) ?? headerMap.get(name.toLowerCase());
    if (!col) return '';
    const raw = row.getCell(col).value;
    if (raw === null || raw === undefined) return '';
    if (raw instanceof Date && !isNaN(raw.getTime())) {
      const d = String(raw.getDate()).padStart(2, '0');
      const m = String(raw.getMonth() + 1).padStart(2, '0');
      const y = raw.getFullYear();
      const hr = String(raw.getHours()).padStart(2, '0');
      const min = String(raw.getMinutes()).padStart(2, '0');
      const sec = String(raw.getSeconds()).padStart(2, '0');
      return `${d}-${m}-${y} ${hr}:${min}:${sec}`;
    }
    return String(raw).trim();
  }
}
