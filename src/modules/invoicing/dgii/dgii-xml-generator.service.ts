import { Injectable } from '@nestjs/common';
import { DgiiConfig, DEFAULT_DGII_CONFIG } from './dgii-config.interface';

export interface EcfItemSubDescuento {
  tipo: string;
  porcentaje?: string;
  monto?: string;
}

export interface EcfItemSubRecargo {
  tipo: string;
  porcentaje?: string;
  monto?: string;
}

export interface EcfItemInput {
  numeroLinea: number;
  nombreItem: string;
  indicadorBienoServicio: '1' | '2'; // 1 = Bien, 2 = Servicio
  indicadorFacturacion: '0' | '1' | '2' | '3' | '4'; // 0 = No Facturable / Informativo, 1 = 18%, 2 = 16%, 3 = 0%, 4 = Exento
  cantidad: number;
  cantidadStr?: string;
  precioUnitario: number;
  precioUnitarioStr?: string;
  montoItem: number;
  montoItemStr?: string;
  descuentoMonto?: number;
  descuentoMontoStr?: string;
  subDescuentos?: EcfItemSubDescuento[];
  recargoMonto?: number;
  recargoMontoStr?: string;
  subRecargos?: EcfItemSubRecargo[];
  cantidadReferenciaStr?: string;
  unidadReferenciaStr?: string;
  subcantidades?: { subcantidad?: string; codigoSubcantidad?: string }[];
  gradosAlcoholStr?: string;
  precioUnitarioReferenciaStr?: string;
  fechaElaboracion?: string;
  fechaVencimientoItem?: string;
  montoITBISRetenido?: number;
  montoISRRetenido?: number;
  indicadorAgenteRetencionoPercepcion?: string;
  itbisRate?: number;
  itbisMonto?: number;
  unidadMedida?: number;
  tiposImpuestoAdicional?: string[];
  impuestosAdicionalesCodigos?: string[];
  descripcionItem?: string;
}

export interface EcfImpuestoAdicionalInput {
  tipoImpuesto: string; // CodificacionTipoImpuestosType, ej. '002' = CDT
  tasa: number; // Porcentaje (ej. 2 para 2%, no 0.02)
  monto: number;
}

export interface EcfEmisorOverride {
  rncEmisor?: string;
  razonSocialEmisor?: string;
  nombreComercial?: string;
  direccionEmisor?: string;
  municipio?: string;
  provincia?: string;
  telefonos?: string[];
  correoEmisor?: string;
  webSite?: string;
  codigoVendedor?: string;
  numeroFacturaInterna?: string;
  numeroPedidoInterno?: string;
  zonaVenta?: string;
  fechaEmisionStr?: string;
}

export interface EcfCompradorOverride {
  rncComprador?: string;
  identificadorExtranjero?: string;
  razonSocialComprador?: string;
  contactoComprador?: string;
  correoComprador?: string;
  direccionComprador?: string;
  municipioComprador?: string;
  provinciaComprador?: string;
  telefonoAdicional?: string;
  fechaEntregaStr?: string;
  fechaOrdenCompraStr?: string;
  numeroOrdenCompra?: string;
  codigoInternoComprador?: string;
}

export interface EcfTotalesOverride {
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
  impuestosAdicionales?: {
    tipoImpuesto: string;
    tasa?: string;
    montoEspecifico?: string;
    montoAdvalorem?: string;
    otrosImpuestos?: string;
  }[];
  montoTotal?: number;
  montoTotalStr?: string;
  montoNoFacturable?: number;
  montoPeriodo?: number;
  valorPagar?: number;
}

export interface EcfInformacionesAdicionalesInput {
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

export interface EcfDescuentoORecargoInput {
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

export interface EcfGenerationInput {
  ncfType: 'E31' | 'E32' | 'E33' | 'E34' | 'E41' | 'E43' | 'E44' | 'E45' | 'E46' | 'E47' | 'B01' | 'B02';
  eNcf: string;
  fechaEmision?: Date;
  fechaVencimientoSecuencia?: string; // dd-MM-yyyy
  tipoPago?: string; // 1=Efectivo/Contado, 2=Credito, 3=Tarjeta/Transferencia
  terminoPago?: string;
  numeroReferencia?: string;
  tipoIngresos?: string;
  indicadorMontoGravado?: string;
  
  // Datos del Comprador
  rncComprador?: string;
  razonSocialComprador: string;
  correoComprador?: string;
  direccionComprador?: string;

  // Informaciones Adicionales y Transporte (embarque, contenedor, pesos)
  informacionesAdicionales?: EcfInformacionesAdicionalesInput;

  // Modificación (para notas de crédito/débito E33/E34)
  ncfModificado?: string;
  fechaNcfModificado?: string;
  codigoModificacion?: '1' | '2' | '3' | '4' | '5';
  razonModificacion?: string;
  indicadorNotaCredito?: '0' | '1';

  // Líneas de detalle
  items: EcfItemInput[];

  // Descuentos o Recargos Globales a nivel de documento
  descuentosORecargos?: EcfDescuentoORecargoInput[];

  // Impuestos adicionales a nivel de comprobante (ej. CDT telecomunicaciones)
  impuestosAdicionales?: EcfImpuestoAdicionalInput[];

  // Overrides dinámicos del set de pruebas oficial
  emisorOverride?: EcfEmisorOverride;
  compradorOverride?: EcfCompradorOverride;
  totalesOverride?: EcfTotalesOverride;
}

export interface AcecfGenerationInput {
  rncEmisor: string;
  rncComprador: string;
  eNcf: string;
  // Fecha y monto del e-CF ORIGINAL que se está aprobando/rechazando (no de
  // la aprobación en sí) — ambos obligatorios según el XSD (acecf.xsd:12-13).
  // Acepta Date o string con formato dd-MM-yyyy / yyyy-MM-dd
  fechaEmisionEcf: Date | string;
  montoTotalEcf: number;
  estadoAprobacion: 1 | 2; // 1 = Aprobado, 2 = Rechazado
  // Solo aplica cuando se rechaza (estadoAprobacion=2); el XSD la nombra
  // "DetalleMotivoRechazo", no "Comentario" (acecf.xsd:16).
  comentario?: string;
  fechaAprobacion?: Date | string;
}

export interface AnecfGenerationInput {
  rncEmisor: string;
  tipoComprobante: string; // ej. '31', '32', '34'
  secuenciaDesde: string;
  secuenciaHasta: string;
  motivo?: string;
}

export interface ArecfGenerationInput {
  rncEmisor: string;
  rncComprador: string;
  eNcf: string;
  estadoRespuesta: 0 | 1; // 0 = Aceptado / Recibido, 1 = Rechazado
  codigoMotivoNoRecibido?: number;
  fechaEmision?: Date;
}

// Código UnidadMedidaType (XSD) para "UND - Unidad". El catálogo DGII no tiene
// un código dedicado a "servicio" — se usa solo para ítems tipo Bien (hardware).
export const UNIDAD_MEDIDA_UND = 43;

/** Catálogo oficial de códigos de 6 dígitos de la División Territorial ONE (DGII ProvinciaMunicipioType) */
export const PROVINCIA_ONE_CODES: Record<string, string> = {
  'DN': '010000',
  'DISTRITO NACIONAL': '010000',
  'SANTO DOMINGO': '320000',
  'SD': '320000',
  'SANTIAGO': '250000',
  'LA VEGA': '130000',
  'SAN CRISTOBAL': '210000',
  'PUERTO PLATA': '180000',
  'DUARTE': '060000',
  'ESPAILLAT': '090000',
  'SAN PEDRO DE MACORIS': '230000',
  'LA ROMANA': '120000',
  'LA ALTAGRACIA': '110000',
  'AZUA': '020000',
  'BARAHONA': '040000',
  'PERAVIA': '170000',
  'VALVERDE': '310000',
  'SAN JUAN': '220000',
  'MONTE PLATA': '290000',
  'SANCHEZ RAMIREZ': '240000',
  'MONSEÑOR NOUEL': '280000',
  'HERMANAS MIRABAL': '190000',
  'MARIA TRINIDAD SANCHEZ': '140000',
  'SAMANA': '200000',
  'HATO MAYOR': '300000',
  'EL SEIBO': '080000',
  'MONTECRISTI': '150000',
  'DAJABON': '050000',
  'SANTIAGO RODRIGUEZ': '260000',
  'ELIAS PIÑA': '070000',
  'BAHORUCO': '030000',
  'INDEPENDENCIA': '100000',
  'PEDERNALES': '160000',
  'SAN JOSE DE OCOA': '270000',
};

/**
 * Normaliza y valida el código de provincia de la empresa conforme a la
 * enumeración de 6 dígitos de la ONE requerida por el esquema XSD de la DGII.
 * Si recibe 'DN', 'Santo Domingo' u otro texto, devuelve el código numérico correspondiente.
 */
export function sanitizeProvincia(provincia?: string): string {
  if (!provincia) return '010000';
  const trimmed = provincia.trim().toUpperCase();
  if (/^\d{6}$/.test(trimmed)) return trimmed;
  return PROVINCIA_ONE_CODES[trimmed] || '010000';
}

/**
 * Sanitiza el correo electrónico del comprador según el patrón estricto del XSD
 * (\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*). En el estándar W3C XML Schema,
 * \w excluye el carácter '_' (guion bajo / punctuation), por lo que se normaliza
 * a '.' para no provocar el rechazo del documento por esquema.
 */
export function sanitizeCorreo(email?: string): string | undefined {
  if (!email) return undefined;
  const trimmed = email.trim();
  const normalized = trimmed.replace(/_/g, '.');
  if (/^[a-zA-Z0-9]+([-+.][a-zA-Z0-9]+)*@[a-zA-Z0-9]+([-.]a-zA-Z0-9]+)*\.[a-zA-Z0-9]+([-.]a-zA-Z0-9]+)*$/.test(normalized)) {
    return normalized;
  }
  return undefined;
}

/**
 * Sanitiza un RNC o Cédula eliminando espacios, guiones y cualquier carácter
 * no numérico para cumplir con el patrón estricto del XSD oficial de la DGII
 * ([0-9]{11}|[0-9]{9}).
 */
export function sanitizeRnc(rnc?: string): string {
  if (!rnc) return '';
  return rnc.replace(/\D/g, '').trim();
}

/**
 * Normaliza el tipo de comprobante ('E31'/'B01'/etc.) al código numérico de
 * TipoeCF que exige el XSD (ej. 'E31'/'B01' -> '31'). Compartido entre el
 * generador de XML y InvoicingService para no duplicar el mapeo.
 */
export function ecfTipoDoc(ncfType: string): string {
  let tipoDoc = ncfType.startsWith('E') ? ncfType.substring(1) : ncfType;
  if (tipoDoc === 'B01') tipoDoc = '31';
  if (tipoDoc === 'B02') tipoDoc = '32';
  return tipoDoc;
}

/**
 * FechaVencimientoSecuencia solo aplica a comprobantes con crédito fiscal
 * (no a Consumo E32 ni Nota de Crédito E34, conforme al XSD y a las muestras
 * oficiales de Representación Impresa de la DGII).
 */
export function usesNcfExpiryDate(ncfType: string): boolean {
  const tipoDoc = ecfTipoDoc(ncfType);
  return tipoDoc !== '32' && tipoDoc !== '34';
}

@Injectable()
export class DgiiXmlGeneratorService {
  /**
   * Formatea un valor numérico decimal a string con 2 posiciones (ej. 1500.00)
   */
  private formatDecimal(value: number): string {
    return (Number(value) || 0).toFixed(2);
  }

  /**
   * Formatea una fecha al formato requerido por la DGII (dd-MM-yyyy)
   */
  private formatDateDgii(date: Date = new Date()): string {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}-${m}-${y}`;
  }

  /**
   * Formatea fecha y hora para el nodo FechaHoraFirma (dd-MM-yyyy HH:mm:ss)
   */
  private formatDateTimeDgii(date: Date = new Date()): string {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    const hr = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const sec = String(date.getSeconds()).padStart(2, '0');
    return `${d}-${m}-${y} ${hr}:${min}:${sec}`;
  }

  /**
   * Normaliza una fecha al formato requerido por la DGII (dd-MM-yyyy).
   * Acepta objetos Date o strings (dd-MM-yyyy, yyyy-MM-dd, ISO).
   */
  private normalizeDateStr(dateOrStr: Date | string | undefined | null): string {
    if (!dateOrStr) return this.formatDateDgii(new Date());
    if (dateOrStr instanceof Date) {
      if (isNaN(dateOrStr.getTime())) return this.formatDateDgii(new Date());
      return this.formatDateDgii(dateOrStr);
    }
    const raw = String(dateOrStr).trim();
    // Si ya viene en formato dd-MM-yyyy (como en el Excel oficial DGII)
    if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) {
      return raw;
    }
    // Si viene en formato ISO yyyy-MM-dd
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
    }
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return this.formatDateDgii(d);
    }
    return raw;
  }

  /**
   * Normaliza fecha/hora al formato DateAndTimeValidation requerido por la DGII (dd-MM-yyyy HH:mm:ss).
   * Los segundos son OBLIGATORIOS según acecf.xsd.
   */
  private normalizeDateTimeStr(dateOrStr: Date | string | undefined | null): string {
    if (!dateOrStr) return this.formatDateTimeDgii(new Date());
    if (dateOrStr instanceof Date) {
      if (isNaN(dateOrStr.getTime())) return this.formatDateTimeDgii(new Date());
      return this.formatDateTimeDgii(dateOrStr);
    }
    const raw = String(dateOrStr).trim();
    // Si ya viene en formato dd-MM-yyyy HH:mm:ss
    if (/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(raw)) {
      return raw;
    }
    // Si viene sin segundos (dd-MM-yyyy HH:mm), agregar :00
    if (/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/.test(raw)) {
      return `${raw}:00`;
    }
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return this.formatDateTimeDgii(d);
    }
    return this.formatDateTimeDgii(new Date());
  }

  /**
   * Escapa caracteres especiales XML para garantizar documento bien formado
   */
  private escapeXml(unsafe: string = ''): string {
    return String(unsafe || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      .replace(/[\r\n\t]/g, ' ')
      .trim();
  }

  /**
   * Genera el documento XML e-CF estándar v1.0 conforme a los esquemas oficiales XSD de la DGII
   */
  generateEcfXml(input: EcfGenerationInput, config: DgiiConfig = DEFAULT_DGII_CONFIG): string {
    const tipoDoc = ecfTipoDoc(input.ncfType);

    const fechaEmisionStr = this.formatDateDgii(input.fechaEmision || new Date());
    const fechaHoraFirmaStr = this.formatDateTimeDgii();

    // 1. Cálculos de Totales Fiscales a partir del detalle de ítems
    let montoGravadoI1 = 0; // Gravado 18%
    let montoGravadoI2 = 0; // Gravado 16%
    let montoGravadoI3 = 0; // Gravado 0%
    let montoExento = 0;

    for (const item of input.items) {
      const lineTotal = item.montoItem !== undefined ? item.montoItem : (item.cantidad * item.precioUnitario);
      if (item.indicadorFacturacion === '1') {
        montoGravadoI1 += lineTotal;
      } else if (item.indicadorFacturacion === '2') {
        montoGravadoI2 += lineTotal;
      } else if (item.indicadorFacturacion === '3') {
        montoGravadoI3 += lineTotal;
      } else {
        montoExento += lineTotal;
      }
    }

    const montoGravadoTotal = montoGravadoI1 + montoGravadoI2 + montoGravadoI3;
    const totalITBIS1 = Number((montoGravadoI1 * 0.18).toFixed(2));
    const totalITBIS2 = Number((montoGravadoI2 * 0.16).toFixed(2));
    const totalITBIS = Number((totalITBIS1 + totalITBIS2).toFixed(2));

    // Impuestos adicionales (ej. CDT — código DGII '002', Ley 153-98 Art. 45)
    const impuestosAdicionales = input.impuestosAdicionales || [];
    const montoImpuestoAdicionalTotal = Number(
      impuestosAdicionales.reduce((sum, t) => sum + t.monto, 0).toFixed(2),
    );

    const montoTotal = Number(
      (montoGravadoTotal + montoExento + totalITBIS + montoImpuestoAdicionalTotal).toFixed(2),
    );

    // Overrides dinámicos del set de pruebas (o cálculo por defecto)
    const effMontoGravadoTotal = input.totalesOverride?.montoGravadoTotal ?? montoGravadoTotal;
    const effMontoGravadoI1 = input.totalesOverride?.montoGravadoI1 ?? montoGravadoI1;
    const effMontoGravadoI2 = input.totalesOverride?.montoGravadoI2 ?? montoGravadoI2;
    const effMontoGravadoI3 = input.totalesOverride?.montoGravadoI3 ?? montoGravadoI3;
    const effMontoExento = input.totalesOverride?.montoExento ?? montoExento;
    const effITBIS1 = input.totalesOverride?.itbis1 ?? (effMontoGravadoI1 > 0 ? '18' : undefined);
    const effITBIS2 = input.totalesOverride?.itbis2 ?? (effMontoGravadoI2 > 0 ? '16' : undefined);
    const effITBIS3 = input.totalesOverride?.itbis3 ?? (effMontoGravadoI3 > 0 ? '0' : undefined);
    const effTotalITBIS = input.totalesOverride?.totalITBIS ?? totalITBIS;
    const effTotalITBIS1 = input.totalesOverride?.totalITBIS1 ?? totalITBIS1;
    const effTotalITBIS2 = input.totalesOverride?.totalITBIS2 ?? totalITBIS2;
    const effTotalITBIS3 = input.totalesOverride?.totalITBIS3 ?? 0;
    const effMontoTotal = input.totalesOverride?.montoTotal ?? montoTotal;

    // 2. Construcción de Secciones XML
    // Contenedor IdDoc
    let idDocXml = 
      `<IdDoc>` +
        `<TipoeCF>${tipoDoc}</TipoeCF>` +
        `<eNCF>${this.escapeXml(input.eNcf)}</eNCF>`;

    if (usesNcfExpiryDate(input.ncfType)) {
      const defaultYear = Math.max(new Date().getFullYear() + 2, 2028);
      const fechaVenc = input.fechaVencimientoSecuencia || config.fechaVencimientoSecuencias || `31-12-${defaultYear}`;
      idDocXml += `<FechaVencimientoSecuencia>${fechaVenc}</FechaVencimientoSecuencia>`;
    }

    if (tipoDoc === '34') {
      // Conforme a e-CF 34 v1.0.xsd:
      // 0 = Si fecha de emisión es <= a 30 días calendario
      // 1 = Si fecha de emisión es > a 30 días calendario
      idDocXml += `<IndicadorNotaCredito>${input.indicadorNotaCredito ?? '0'}</IndicadorNotaCredito>`;
    }

    // IndicadorMontoGravado solo aplica a 31, 32, 33, 34, 41 y 45 según sus respectivos esquemas oficiales
    // En el XSD de la DGII:
    //   0 = Los montos en las líneas NO tienen ITBIS incluido (precio neto + ITBIS = MontoTotal)
    //   1 = Los montos en las líneas tienen ITBIS incluido
    // En facturación estándar y en la simulación oficial, MontoItem es NETO sin ITBIS,
    // por lo que IndicadorMontoGravado debe ser '0' (nunca '1', lo que causaría que la DGII
    // divida MontoItem entre 1.18 y rechace por descuadre con MontoGravadoI1).
    const supportsIndicadorMontoGravado = ['31', '32', '33', '34', '41', '45'].includes(tipoDoc);
    if (supportsIndicadorMontoGravado) {
      const finalIndicadorMontoGravado =
        input.indicadorMontoGravado !== undefined && input.indicadorMontoGravado !== ''
          ? input.indicadorMontoGravado
          : '0';

      idDocXml += `<IndicadorMontoGravado>${finalIndicadorMontoGravado}</IndicadorMontoGravado>`;
    }

    // TipoIngresos no existe en E41, E43 ni E47 según sus respectivos esquemas oficiales
    if (tipoDoc !== '41' && tipoDoc !== '43' && tipoDoc !== '47') {
      if (input.tipoIngresos !== undefined) {
        if (input.tipoIngresos !== '') {
          idDocXml += `<TipoIngresos>${input.tipoIngresos}</TipoIngresos>`;
        }
      } else {
        idDocXml += `<TipoIngresos>01</TipoIngresos>`;
      }
    }

    if (input.tipoPago !== undefined) {
      if (input.tipoPago !== '') {
        idDocXml += `<TipoPago>${input.tipoPago}</TipoPago>`;
      }
    } else {
      idDocXml += `<TipoPago>1</TipoPago>`;
    }
    if (input.terminoPago) {
      idDocXml += `<TerminoPago>${this.escapeXml(input.terminoPago)}</TerminoPago>`;
    }
    idDocXml += `</IdDoc>`;

    // Contenedor Emisor
    const rncEmisorVal = sanitizeRnc(input.emisorOverride?.rncEmisor || config.rncEmisor);
    const razonSocialEmisorVal = input.emisorOverride?.razonSocialEmisor || config.razonSocialEmisor;
    const nombreComercialVal = input.emisorOverride !== undefined ? input.emisorOverride.nombreComercial : config.nombreComercial;
    const direccionEmisorVal = input.emisorOverride?.direccionEmisor || config.direccionEmisor || 'Santo Domingo, Rep. Dom.';
    const municipioVal = input.emisorOverride !== undefined ? input.emisorOverride.municipio : config.municipioEmisor;
    const hasExplicitProvincia = input.emisorOverride !== undefined;
    const provinciaValida = hasExplicitProvincia ? (input.emisorOverride?.provincia || '') : sanitizeProvincia(config.provinciaEmisor);
    const telefonos = input.emisorOverride?.telefonos || (config.telefonoEmisor ? [config.telefonoEmisor] : []);
    const correoEmisorVal = input.emisorOverride !== undefined ? input.emisorOverride.correoEmisor : config.correoEmisor;
    const webSiteVal = input.emisorOverride !== undefined ? input.emisorOverride.webSite : config.webSite;
    const fechaEmisionVal = input.emisorOverride?.fechaEmisionStr || fechaEmisionStr;

    let emisorXml = 
      `<Emisor>` +
        `<RNCEmisor>${rncEmisorVal}</RNCEmisor>` +
        `<RazonSocialEmisor>${this.escapeXml(razonSocialEmisorVal)}</RazonSocialEmisor>`;

    if (nombreComercialVal) {
      emisorXml += `<NombreComercial>${this.escapeXml(nombreComercialVal)}</NombreComercial>`;
    }

    emisorXml += `<DireccionEmisor>${this.escapeXml(direccionEmisorVal)}</DireccionEmisor>`;

    if (municipioVal) {
      emisorXml += `<Municipio>${this.escapeXml(municipioVal)}</Municipio>`;
    }
    if (provinciaValida) {
      emisorXml += `<Provincia>${provinciaValida}</Provincia>`;
    }

    if (telefonos && telefonos.length > 0) {
      emisorXml += `<TablaTelefonoEmisor>` + telefonos.map((t) => `<TelefonoEmisor>${this.escapeXml(t)}</TelefonoEmisor>`).join('') + `</TablaTelefonoEmisor>`;
    }
    if (correoEmisorVal) {
      emisorXml += `<CorreoEmisor>${this.escapeXml(correoEmisorVal)}</CorreoEmisor>`;
    }
    if (webSiteVal) {
      emisorXml += `<WebSite>${this.escapeXml(webSiteVal)}</WebSite>`;
    }

    // Campos de venta interna del emisor (después de WebSite y antes de FechaEmision en XSD)
    const emisorConCamposVenta = ['31', '32', '33', '34', '44', '45', '46'].includes(tipoDoc);
    const emisorConFacturaInterna = emisorConCamposVenta || ['41', '43', '47'].includes(tipoDoc);

    if (emisorConCamposVenta && input.emisorOverride?.codigoVendedor) {
      emisorXml += `<CodigoVendedor>${this.escapeXml(input.emisorOverride.codigoVendedor)}</CodigoVendedor>`;
    }
    if (emisorConFacturaInterna && input.emisorOverride?.numeroFacturaInterna) {
      emisorXml += `<NumeroFacturaInterna>${this.escapeXml(input.emisorOverride.numeroFacturaInterna)}</NumeroFacturaInterna>`;
    }
    if (emisorConFacturaInterna && input.emisorOverride?.numeroPedidoInterno) {
      emisorXml += `<NumeroPedidoInterno>${this.escapeXml(input.emisorOverride.numeroPedidoInterno)}</NumeroPedidoInterno>`;
    }
    if (emisorConCamposVenta && input.emisorOverride?.zonaVenta) {
      emisorXml += `<ZonaVenta>${this.escapeXml(input.emisorOverride.zonaVenta)}</ZonaVenta>`;
    }

    emisorXml += `<FechaEmision>${fechaEmisionVal}</FechaEmision></Emisor>`;

    // Contenedor Comprador
    let compradorXml = '';
    if (tipoDoc === '43') {
      compradorXml = '';
    } else if (tipoDoc === '47') {
      const idExtranjero = input.compradorOverride?.identificadorExtranjero || input.rncComprador || 'EXPORT-001';
      compradorXml =
        `<Comprador>` +
          `<IdentificadorExtranjero>${this.escapeXml(idExtranjero)}</IdentificadorExtranjero>` +
          `<RazonSocialComprador>${this.escapeXml(input.razonSocialComprador || 'FOREIGN CLIENT')}</RazonSocialComprador>` +
        `</Comprador>`;
    } else {
      compradorXml = `<Comprador>`;
      const rawRnc = sanitizeRnc(input.rncComprador);
      if (rawRnc.length === 9 || rawRnc.length === 11) {
        compradorXml += `<RNCComprador>${rawRnc}</RNCComprador>`;
      } else if (input.compradorOverride?.identificadorExtranjero) {
        compradorXml += `<IdentificadorExtranjero>${this.escapeXml(input.compradorOverride.identificadorExtranjero)}</IdentificadorExtranjero>`;
      }

      compradorXml += `<RazonSocialComprador>${this.escapeXml(input.razonSocialComprador || 'Consumidor Final')}</RazonSocialComprador>`;

      if (input.compradorOverride?.contactoComprador) {
        compradorXml += `<ContactoComprador>${this.escapeXml(input.compradorOverride.contactoComprador)}</ContactoComprador>`;
      }

      const emailVal = input.compradorOverride ? input.compradorOverride.correoComprador : input.correoComprador;
      if (emailVal) {
        const sanitizedEmail = sanitizeCorreo(emailVal);
        if (sanitizedEmail) {
          compradorXml += `<CorreoComprador>${this.escapeXml(sanitizedEmail)}</CorreoComprador>`;
        }
      }

      const dirVal = input.compradorOverride ? input.compradorOverride.direccionComprador : input.direccionComprador;
      if (dirVal) {
        compradorXml += `<DireccionComprador>${this.escapeXml(dirVal)}</DireccionComprador>`;
      }

      if (input.compradorOverride?.municipioComprador) {
        compradorXml += `<MunicipioComprador>${this.escapeXml(input.compradorOverride.municipioComprador)}</MunicipioComprador>`;
      }
      if (input.compradorOverride?.provinciaComprador) {
        compradorXml += `<ProvinciaComprador>${this.escapeXml(input.compradorOverride.provinciaComprador)}</ProvinciaComprador>`;
      }
      if (input.compradorOverride?.telefonoAdicional) {
        compradorXml += `<TelefonoAdicional>${this.escapeXml(input.compradorOverride.telefonoAdicional)}</TelefonoAdicional>`;
      }

      // Entrega y Orden de Compra (XSD sequence dentro de Comprador)
      const compradorConEntregaYOrden = ['31', '32', '33', '34', '44', '45', '46'].includes(tipoDoc);
      if (compradorConEntregaYOrden) {
        if (input.compradorOverride?.fechaEntregaStr) {
          compradorXml += `<FechaEntrega>${input.compradorOverride.fechaEntregaStr}</FechaEntrega>`;
        }
        if (input.compradorOverride?.fechaOrdenCompraStr) {
          compradorXml += `<FechaOrdenCompra>${input.compradorOverride.fechaOrdenCompraStr}</FechaOrdenCompra>`;
        }
        if (input.compradorOverride?.numeroOrdenCompra) {
          compradorXml += `<NumeroOrdenCompra>${this.escapeXml(input.compradorOverride.numeroOrdenCompra)}</NumeroOrdenCompra>`;
        }
      }
      if ((compradorConEntregaYOrden || tipoDoc === '41') && input.compradorOverride?.codigoInternoComprador) {
        compradorXml += `<CodigoInternoComprador>${this.escapeXml(input.compradorOverride.codigoInternoComprador)}</CodigoInternoComprador>`;
      }

      compradorXml += `</Comprador>`;
    }

    // Informaciones Adicionales (después de Comprador y antes de Totales según XSD)
    let infoAdicXml = '';
    const permiteInfoAdicionales = ['31', '32', '33', '34', '44', '45', '46'].includes(tipoDoc);
    if (permiteInfoAdicionales) {
      const ia = input.informacionesAdicionales;
      const fEmb = ia?.fechaEmbarque;
      const nEmb = ia?.numeroEmbarque;
      const nCont = ia?.numeroContenedor;
      const nRef = ia?.numeroReferencia || input.numeroReferencia;
      const pBruto = ia?.pesoBruto;
      const pNeto = ia?.pesoNeto;
      const uPBruto = ia?.unidadPesoBruto;
      const uPNeto = ia?.unidadPesoNeto;
      const cBulto = ia?.cantidadBulto;
      const uBulto = ia?.unidadBulto;
      const vBulto = ia?.volumenBulto;
      const uVol = ia?.unidadVolumen;

      if (fEmb || nEmb || nCont || nRef || pBruto || pNeto || uPBruto || uPNeto || cBulto || uBulto || vBulto || uVol) {
        infoAdicXml = `<InformacionesAdicionales>`;
        if (fEmb) infoAdicXml += `<FechaEmbarque>${fEmb}</FechaEmbarque>`;
        if (nEmb) infoAdicXml += `<NumeroEmbarque>${this.escapeXml(nEmb)}</NumeroEmbarque>`;
        if (nCont) infoAdicXml += `<NumeroContenedor>${this.escapeXml(nCont)}</NumeroContenedor>`;
        if (nRef) infoAdicXml += `<NumeroReferencia>${this.escapeXml(nRef)}</NumeroReferencia>`;
        if (pBruto) infoAdicXml += `<PesoBruto>${pBruto}</PesoBruto>`;
        if (pNeto) infoAdicXml += `<PesoNeto>${pNeto}</PesoNeto>`;
        if (uPBruto) infoAdicXml += `<UnidadPesoBruto>${uPBruto}</UnidadPesoBruto>`;
        if (uPNeto) infoAdicXml += `<UnidadPesoNeto>${uPNeto}</UnidadPesoNeto>`;
        if (cBulto) infoAdicXml += `<CantidadBulto>${cBulto}</CantidadBulto>`;
        if (uBulto) infoAdicXml += `<UnidadBulto>${uBulto}</UnidadBulto>`;
        if (vBulto) infoAdicXml += `<VolumenBulto>${vBulto}</VolumenBulto>`;
        if (uVol) infoAdicXml += `<UnidadVolumen>${uVol}</UnidadVolumen>`;
        infoAdicXml += `</InformacionesAdicionales>`;
      }
    }

    // Contenedor Totales
    let totalesXml = `<Totales>`;
    if (tipoDoc === '43') {
      totalesXml +=
        `<MontoExento>${input.totalesOverride?.montoExentoStr || this.formatDecimal(effMontoExento || effMontoTotal)}</MontoExento>` +
        `<MontoTotal>${input.totalesOverride?.montoTotalStr || this.formatDecimal(effMontoTotal)}</MontoTotal>` +
      `</Totales>`;
    } else if (tipoDoc === '46') {
      totalesXml +=
        `<MontoGravadoTotal>${input.totalesOverride?.montoGravadoTotalStr || this.formatDecimal(effMontoGravadoTotal || effMontoTotal)}</MontoGravadoTotal>` +
        `<MontoGravadoI3>${input.totalesOverride?.montoGravadoI3Str || this.formatDecimal(effMontoGravadoI3 || effMontoGravadoTotal || effMontoTotal)}</MontoGravadoI3>` +
        `<ITBIS3>0</ITBIS3>` +
        `<TotalITBIS>${input.totalesOverride?.totalITBISStr || '0.00'}</TotalITBIS>` +
        `<TotalITBIS3>${input.totalesOverride?.totalITBIS3Str || '0.00'}</TotalITBIS3>` +
        `<MontoTotal>${input.totalesOverride?.montoTotalStr || this.formatDecimal(effMontoTotal)}</MontoTotal>`;
      if (input.totalesOverride?.montoPeriodo !== undefined) {
        totalesXml += `<MontoPeriodo>${this.formatDecimal(input.totalesOverride.montoPeriodo)}</MontoPeriodo>`;
      }
      if (input.totalesOverride?.valorPagar !== undefined) {
        totalesXml += `<ValorPagar>${this.formatDecimal(input.totalesOverride.valorPagar)}</ValorPagar>`;
      }
      totalesXml += `</Totales>`;
    } else if (tipoDoc === '47') {
      if (input.totalesOverride?.montoExentoStr !== undefined) {
        totalesXml += `<MontoExento>${input.totalesOverride.montoExentoStr}</MontoExento>`;
      } else if (effMontoExento > 0 || effMontoTotal > 0) {
        totalesXml += `<MontoExento>${this.formatDecimal(effMontoExento || effMontoTotal)}</MontoExento>`;
      }
      totalesXml += `<MontoTotal>${input.totalesOverride?.montoTotalStr || this.formatDecimal(effMontoTotal)}</MontoTotal>`;
      if (input.totalesOverride?.montoPeriodo !== undefined) {
        totalesXml += `<MontoPeriodo>${this.formatDecimal(input.totalesOverride.montoPeriodo)}</MontoPeriodo>`;
      }
      if (input.totalesOverride?.valorPagar !== undefined) {
        totalesXml += `<ValorPagar>${this.formatDecimal(input.totalesOverride.valorPagar)}</ValorPagar>`;
      }
      const isrRet = input.totalesOverride?.totalISRRetencion ?? input.items.reduce((acc, i) => acc + (i.montoISRRetenido || 0), 0);
      totalesXml += `<TotalISRRetencion>${this.formatDecimal(isrRet)}</TotalISRRetencion></Totales>`;
    } else if (tipoDoc === '44') {
      const exentoVal = input.totalesOverride?.montoExentoStr || this.formatDecimal(effMontoExento || effMontoTotal);
      totalesXml += `<MontoExento>${exentoVal}</MontoExento>`;
      totalesXml += `<MontoTotal>${input.totalesOverride?.montoTotalStr || this.formatDecimal(effMontoTotal)}</MontoTotal>`;
      if (input.totalesOverride?.montoPeriodo !== undefined) {
        totalesXml += `<MontoPeriodo>${this.formatDecimal(input.totalesOverride.montoPeriodo)}</MontoPeriodo>`;
      }
      if (input.totalesOverride?.valorPagar !== undefined) {
        totalesXml += `<ValorPagar>${this.formatDecimal(input.totalesOverride.valorPagar)}</ValorPagar>`;
      }
      totalesXml += `</Totales>`;
    } else {
      if (input.totalesOverride?.montoGravadoTotalStr !== undefined) {
        totalesXml += `<MontoGravadoTotal>${input.totalesOverride.montoGravadoTotalStr}</MontoGravadoTotal>`;
        if (input.totalesOverride.montoGravadoI1Str !== undefined) {
          totalesXml += `<MontoGravadoI1>${input.totalesOverride.montoGravadoI1Str}</MontoGravadoI1>`;
        }
        if (input.totalesOverride.montoGravadoI2Str !== undefined) {
          totalesXml += `<MontoGravadoI2>${input.totalesOverride.montoGravadoI2Str}</MontoGravadoI2>`;
        }
        if (input.totalesOverride.montoGravadoI3Str !== undefined) {
          totalesXml += `<MontoGravadoI3>${input.totalesOverride.montoGravadoI3Str}</MontoGravadoI3>`;
        }
      } else if (effMontoGravadoTotal > 0) {
        totalesXml += `<MontoGravadoTotal>${this.formatDecimal(effMontoGravadoTotal)}</MontoGravadoTotal>`;
        if (effMontoGravadoI1 > 0) {
          totalesXml += `<MontoGravadoI1>${this.formatDecimal(effMontoGravadoI1)}</MontoGravadoI1>`;
        }
        if (effMontoGravadoI2 > 0) {
          totalesXml += `<MontoGravadoI2>${this.formatDecimal(effMontoGravadoI2)}</MontoGravadoI2>`;
        }
        if (effMontoGravadoI3 > 0) {
          totalesXml += `<MontoGravadoI3>${this.formatDecimal(effMontoGravadoI3)}</MontoGravadoI3>`;
        }
      }

      if (input.totalesOverride?.montoExentoStr !== undefined) {
        totalesXml += `<MontoExento>${input.totalesOverride.montoExentoStr}</MontoExento>`;
      } else if (effMontoExento > 0) {
        totalesXml += `<MontoExento>${this.formatDecimal(effMontoExento)}</MontoExento>`;
      }

      if (effITBIS1) {
        totalesXml += `<ITBIS1>${effITBIS1}</ITBIS1>`;
      }
      if (effITBIS2) {
        totalesXml += `<ITBIS2>${effITBIS2}</ITBIS2>`;
      }
      if (effITBIS3) {
        totalesXml += `<ITBIS3>${effITBIS3}</ITBIS3>`;
      }

      if (input.totalesOverride?.totalITBISStr !== undefined) {
        totalesXml += `<TotalITBIS>${input.totalesOverride.totalITBISStr}</TotalITBIS>`;
        if (input.totalesOverride.totalITBIS1Str !== undefined) {
          totalesXml += `<TotalITBIS1>${input.totalesOverride.totalITBIS1Str}</TotalITBIS1>`;
        }
        if (input.totalesOverride.totalITBIS2Str !== undefined) {
          totalesXml += `<TotalITBIS2>${input.totalesOverride.totalITBIS2Str}</TotalITBIS2>`;
        }
        if (input.totalesOverride.totalITBIS3Str !== undefined) {
          totalesXml += `<TotalITBIS3>${input.totalesOverride.totalITBIS3Str}</TotalITBIS3>`;
        }
      } else if (effTotalITBIS > 0 || (effMontoGravadoI3 > 0 && tipoDoc !== '41')) {
        totalesXml += `<TotalITBIS>${this.formatDecimal(effTotalITBIS)}</TotalITBIS>`;
        if (effTotalITBIS1 > 0) {
          totalesXml += `<TotalITBIS1>${this.formatDecimal(effTotalITBIS1)}</TotalITBIS1>`;
        }
        if (effTotalITBIS2 > 0) {
          totalesXml += `<TotalITBIS2>${this.formatDecimal(effTotalITBIS2)}</TotalITBIS2>`;
        }
        if (effTotalITBIS3 > 0) {
          totalesXml += `<TotalITBIS3>${this.formatDecimal(effTotalITBIS3)}</TotalITBIS3>`;
        }
      }

      if (input.totalesOverride?.montoImpuestoAdicionalStr !== undefined) {
        totalesXml += `<MontoImpuestoAdicional>${input.totalesOverride.montoImpuestoAdicionalStr}</MontoImpuestoAdicional>`;
        if (input.totalesOverride.impuestosAdicionales && input.totalesOverride.impuestosAdicionales.length > 0) {
          totalesXml += `<ImpuestosAdicionales>`;
          input.totalesOverride.impuestosAdicionales.forEach((tax) => {
            totalesXml +=
              `<ImpuestoAdicional>` +
                `<TipoImpuesto>${this.escapeXml(tax.tipoImpuesto)}</TipoImpuesto>` +
                (tax.tasa !== undefined && tax.tasa !== null && String(tax.tasa).trim() !== '' ? `<TasaImpuestoAdicional>${this.escapeXml(String(tax.tasa).trim())}</TasaImpuestoAdicional>` : '') +
                (tax.montoEspecifico !== undefined && tax.montoEspecifico !== null && String(tax.montoEspecifico).trim() !== '' ? `<MontoImpuestoSelectivoConsumoEspecifico>${this.escapeXml(String(tax.montoEspecifico).trim())}</MontoImpuestoSelectivoConsumoEspecifico>` : '') +
                (tax.montoAdvalorem !== undefined && tax.montoAdvalorem !== null && String(tax.montoAdvalorem).trim() !== '' ? `<MontoImpuestoSelectivoConsumoAdvalorem>${this.escapeXml(String(tax.montoAdvalorem).trim())}</MontoImpuestoSelectivoConsumoAdvalorem>` : '') +
                (tax.otrosImpuestos !== undefined && tax.otrosImpuestos !== null && String(tax.otrosImpuestos).trim() !== '' ? `<OtrosImpuestosAdicionales>${this.escapeXml(String(tax.otrosImpuestos).trim())}</OtrosImpuestosAdicionales>` : '') +
              `</ImpuestoAdicional>`;
          });
          totalesXml += `</ImpuestosAdicionales>`;
        }
      } else if (montoImpuestoAdicionalTotal > 0) {
        totalesXml += `<MontoImpuestoAdicional>${this.formatDecimal(montoImpuestoAdicionalTotal)}</MontoImpuestoAdicional>`;
        totalesXml += `<ImpuestosAdicionales>`;
        impuestosAdicionales.forEach((tax) => {
          totalesXml +=
            `<ImpuestoAdicional>` +
              `<TipoImpuesto>${this.escapeXml(tax.tipoImpuesto)}</TipoImpuesto>` +
              `<TasaImpuestoAdicional>${this.formatDecimal(tax.tasa)}</TasaImpuestoAdicional>` +
              `<OtrosImpuestosAdicionales>${this.formatDecimal(tax.monto)}</OtrosImpuestosAdicionales>` +
            `</ImpuestoAdicional>`;
        });
        totalesXml += `</ImpuestosAdicionales>`;
      }

      totalesXml += `<MontoTotal>${input.totalesOverride?.montoTotalStr || this.formatDecimal(effMontoTotal)}</MontoTotal>`;

      if (input.totalesOverride?.montoNoFacturable !== undefined) {
        totalesXml += `<MontoNoFacturable>${this.formatDecimal(input.totalesOverride.montoNoFacturable)}</MontoNoFacturable>`;
      }
      if (input.totalesOverride?.montoPeriodo !== undefined) {
        totalesXml += `<MontoPeriodo>${this.formatDecimal(input.totalesOverride.montoPeriodo)}</MontoPeriodo>`;
      }
      if (input.totalesOverride?.valorPagar !== undefined) {
        totalesXml += `<ValorPagar>${this.formatDecimal(input.totalesOverride.valorPagar)}</ValorPagar>`;
      }

      if (tipoDoc === '41') {
        const itbisRet = input.totalesOverride?.totalITBISRetenido ?? input.items.reduce((acc, i) => acc + (i.montoITBISRetenido || 0), 0);
        if (itbisRet > 0) {
          totalesXml += `<TotalITBISRetenido>${this.formatDecimal(itbisRet)}</TotalITBISRetenido>`;
        }
        const isrRet = input.totalesOverride?.totalISRRetencion ?? input.items.reduce((acc, i) => acc + (i.montoISRRetenido || 0), 0);
        if (isrRet > 0) {
          totalesXml += `<TotalISRRetencion>${this.formatDecimal(isrRet)}</TotalISRRetencion>`;
        }
      }

      totalesXml += `</Totales>`;
    }

    // Contenedor DetallesItems
    let itemsXml = `<DetallesItems>`;
    input.items.forEach((item, index) => {
      const lineNum = item.numeroLinea || (index + 1);
      const lineTotal = item.montoItem !== undefined ? item.montoItem : (item.cantidad * item.precioUnitario);
      const cantFormatted = item.cantidadStr || this.formatDecimal(item.cantidad);
      const precioFormatted = item.precioUnitarioStr || this.formatDecimal(item.precioUnitario);
      const montoItemFormatted = item.montoItemStr || this.formatDecimal(lineTotal);

      let retencionXml = '';
      if (tipoDoc === '41') {
        const indAg = item.indicadorAgenteRetencionoPercepcion || '1';
        retencionXml = `<Retencion>` +
          `<IndicadorAgenteRetencionoPercepcion>${indAg}</IndicadorAgenteRetencionoPercepcion>`;
        if (item.montoITBISRetenido !== undefined && item.montoITBISRetenido > 0) {
          retencionXml += `<MontoITBISRetenido>${this.formatDecimal(item.montoITBISRetenido)}</MontoITBISRetenido>`;
        }
        if (item.montoISRRetenido !== undefined && item.montoISRRetenido > 0) {
          retencionXml += `<MontoISRRetenido>${this.formatDecimal(item.montoISRRetenido)}</MontoISRRetenido>`;
        }
        retencionXml += `</Retencion>`;
      } else if (tipoDoc === '47') {
        retencionXml = `<Retencion><IndicadorAgenteRetencionoPercepcion>1</IndicadorAgenteRetencionoPercepcion><MontoISRRetenido>${this.formatDecimal(item.montoISRRetenido || 0)}</MontoISRRetenido></Retencion>`;
      } else if ((item.montoITBISRetenido !== undefined && item.montoITBISRetenido > 0) || (item.montoISRRetenido !== undefined && item.montoISRRetenido > 0)) {
        const indAg = item.indicadorAgenteRetencionoPercepcion || '1';
        retencionXml = `<Retencion>` +
          `<IndicadorAgenteRetencionoPercepcion>${indAg}</IndicadorAgenteRetencionoPercepcion>`;
        if (item.montoITBISRetenido !== undefined && item.montoITBISRetenido > 0) {
          retencionXml += `<MontoITBISRetenido>${this.formatDecimal(item.montoITBISRetenido)}</MontoITBISRetenido>`;
        }
        if (item.montoISRRetenido !== undefined && item.montoISRRetenido > 0) {
          retencionXml += `<MontoISRRetenido>${this.formatDecimal(item.montoISRRetenido)}</MontoISRRetenido>`;
        }
        retencionXml += `</Retencion>`;
      }

      itemsXml +=
        `<Item>` +
          `<NumeroLinea>${lineNum}</NumeroLinea>` +
          `<IndicadorFacturacion>${item.indicadorFacturacion || '1'}</IndicadorFacturacion>` +
          retencionXml +
          `<NombreItem>${this.escapeXml(item.nombreItem)}</NombreItem>` +
          `<IndicadorBienoServicio>${item.indicadorBienoServicio || '2'}</IndicadorBienoServicio>`;

      if (item.descripcionItem) {
        itemsXml += `<DescripcionItem>${this.escapeXml(item.descripcionItem)}</DescripcionItem>`;
      }

      itemsXml += `<CantidadItem>${cantFormatted}</CantidadItem>`;

      if (item.unidadMedida) {
        itemsXml += `<UnidadMedida>${item.unidadMedida}</UnidadMedida>`;
      }
      if (item.cantidadReferenciaStr) {
        itemsXml += `<CantidadReferencia>${item.cantidadReferenciaStr}</CantidadReferencia>`;
      }
      if (item.unidadReferenciaStr) {
        itemsXml += `<UnidadReferencia>${item.unidadReferenciaStr}</UnidadReferencia>`;
      }
      if (item.subcantidades && item.subcantidades.length > 0) {
        itemsXml += `<TablaSubcantidad>`;
        item.subcantidades.forEach((sc) => {
          itemsXml += `<SubcantidadItem>`;
          if (sc.subcantidad) itemsXml += `<Subcantidad>${sc.subcantidad}</Subcantidad>`;
          if (sc.codigoSubcantidad) itemsXml += `<CodigoSubcantidad>${sc.codigoSubcantidad}</CodigoSubcantidad>`;
          itemsXml += `</SubcantidadItem>`;
        });
        itemsXml += `</TablaSubcantidad>`;
      }
      if (item.gradosAlcoholStr) {
        itemsXml += `<GradosAlcohol>${item.gradosAlcoholStr}</GradosAlcohol>`;
      }
      if (item.precioUnitarioReferenciaStr) {
        itemsXml += `<PrecioUnitarioReferencia>${item.precioUnitarioReferenciaStr}</PrecioUnitarioReferencia>`;
      }
      if (item.fechaElaboracion) {
        itemsXml += `<FechaElaboracion>${item.fechaElaboracion}</FechaElaboracion>`;
      }
      if (item.fechaVencimientoItem) {
        itemsXml += `<FechaVencimientoItem>${item.fechaVencimientoItem}</FechaVencimientoItem>`;
      }

      itemsXml += `<PrecioUnitarioItem>${precioFormatted}</PrecioUnitarioItem>`;

      if (item.descuentoMontoStr || (item.descuentoMonto && item.descuentoMonto > 0)) {
        const descVal = item.descuentoMontoStr || this.formatDecimal(item.descuentoMonto!);
        itemsXml += `<DescuentoMonto>${descVal}</DescuentoMonto>`;
        if (item.subDescuentos && item.subDescuentos.length > 0) {
          itemsXml += `<TablaSubDescuento>`;
          item.subDescuentos.forEach((sd) => {
            itemsXml +=
              `<SubDescuento>` +
                `<TipoSubDescuento>${this.escapeXml(sd.tipo)}</TipoSubDescuento>` +
                (sd.porcentaje ? `<SubDescuentoPorcentaje>${sd.porcentaje}</SubDescuentoPorcentaje>` : '') +
                (sd.monto ? `<MontoSubDescuento>${sd.monto}</MontoSubDescuento>` : '') +
              `</SubDescuento>`;
          });
          itemsXml += `</TablaSubDescuento>`;
        }
      }

      if (item.recargoMontoStr || (item.recargoMonto && item.recargoMonto > 0)) {
        const recVal = item.recargoMontoStr || this.formatDecimal(item.recargoMonto!);
        itemsXml += `<RecargoMonto>${recVal}</RecargoMonto>`;
        if (item.subRecargos && item.subRecargos.length > 0) {
          itemsXml += `<TablaSubRecargo>`;
          item.subRecargos.forEach((sr) => {
            itemsXml +=
              `<SubRecargo>` +
                `<TipoSubRecargo>${this.escapeXml(sr.tipo)}</TipoSubRecargo>` +
                (sr.porcentaje ? `<SubRecargoPorcentaje>${sr.porcentaje}</SubRecargoPorcentaje>` : '') +
                (sr.monto ? `<MontoSubRecargo>${sr.monto}</MontoSubRecargo>` : '') +
              `</SubRecargo>`;
          });
          itemsXml += `</TablaSubRecargo>`;
        }
      }

      // Impuestos adicionales aplicados a la línea de ítem
      const itemTaxCodes = item.impuestosAdicionalesCodigos || item.tiposImpuestoAdicional || [];
      if (itemTaxCodes.length > 0) {
        itemsXml +=
          `<TablaImpuestoAdicional>` +
          itemTaxCodes
            .slice(0, 2)
            .map((tipo) => `<ImpuestoAdicional><TipoImpuesto>${this.escapeXml(tipo)}</TipoImpuesto></ImpuestoAdicional>`)
            .join('') +
          `</TablaImpuestoAdicional>`;
      }

      itemsXml += `<MontoItem>${montoItemFormatted}</MontoItem></Item>`;
    });
    itemsXml += `</DetallesItems>`;

    // Descuentos o Recargos Globales (a nivel de documento, después de DetallesItems)
    let descuentosORecargosXml = '';
    const permiteDor = ['31', '32', '33', '34', '41', '44', '45', '46'].includes(tipoDoc);
    if (permiteDor && input.descuentosORecargos && input.descuentosORecargos.length > 0) {
      descuentosORecargosXml = `<DescuentosORecargos>`;
      input.descuentosORecargos.forEach((dor) => {
        descuentosORecargosXml += `<DescuentoORecargo>` +
          `<NumeroLinea>${dor.numeroLinea}</NumeroLinea>` +
          `<TipoAjuste>${this.escapeXml(dor.tipoAjuste)}</TipoAjuste>` +
          (dor.indicadorNorma1007 ? `<IndicadorNorma1007>${dor.indicadorNorma1007}</IndicadorNorma1007>` : '') +
          (dor.descripcion ? `<DescripcionDescuentooRecargo>${this.escapeXml(dor.descripcion)}</DescripcionDescuentooRecargo>` : '') +
          (dor.tipoValor ? `<TipoValor>${this.escapeXml(dor.tipoValor)}</TipoValor>` : '') +
          (dor.valor ? `<ValorDescuentooRecargo>${dor.valor}</ValorDescuentooRecargo>` : '') +
          (dor.monto ? `<MontoDescuentooRecargo>${dor.monto}</MontoDescuentooRecargo>` : '') +
          (dor.montoOtraMoneda ? `<MontoDescuentooRecargoOtraMoneda>${dor.montoOtraMoneda}</MontoDescuentooRecargoOtraMoneda>` : '') +
          (dor.indicadorFacturacion ? `<IndicadorFacturacionDescuentooRecargo>${dor.indicadorFacturacion}</IndicadorFacturacionDescuentooRecargo>` : '') +
        `</DescuentoORecargo>`;
      });
      descuentosORecargosXml += `</DescuentosORecargos>`;
    }

    // Información de Referencia (solo si es Nota de Crédito/Débito E33/E34)
    let infoRefXml = '';
    if ((tipoDoc === '33' || tipoDoc === '34') && input.ncfModificado) {
      const fechaNcfMod = input.fechaNcfModificado || fechaEmisionVal || this.formatDateDgii();
      infoRefXml = 
        `<InformacionReferencia>` +
          `<NCFModificado>${this.escapeXml(input.ncfModificado)}</NCFModificado>` +
          `<FechaNCFModificado>${fechaNcfMod}</FechaNCFModificado>` +
          `<CodigoModificacion>${input.codigoModificacion || '1'}</CodigoModificacion>`;
      if (input.razonModificacion !== undefined) {
        if (input.razonModificacion.trim() !== '') {
          infoRefXml += `<RazonModificacion>${this.escapeXml(input.razonModificacion)}</RazonModificacion>`;
        }
      } else {
        infoRefXml += `<RazonModificacion>Ajuste de Facturación</RazonModificacion>`;
      }
      infoRefXml += `</InformacionReferencia>`;
    }

    // Documento Raíz ECF
    return (
      `<ECF>` +
        `<Encabezado>` +
          `<Version>1.0</Version>` +
          idDocXml +
          emisorXml +
          compradorXml +
          infoAdicXml +
          totalesXml +
        `</Encabezado>` +
        itemsXml +
        descuentosORecargosXml +
        infoRefXml +
        `<FechaHoraFirma>${fechaHoraFirmaStr}</FechaHoraFirma>` +
      `</ECF>`
    );
  }

  /**
   * Genera el XML del Resumen de Factura de Consumo Electrónica (RFCE) para e-CF tipo 32 < RD$ 250,000
   * Conforme al esquema oficial rfce-32.xsd de la DGII.
   */
  generateRfceXml(
    eNcf: string,
    rncEmisor: string,
    montoTotal: number,
    itbisTotal: number,
    codigoSeguridad: string,
    extraOptions?: {
      razonSocialEmisor?: string;
      fechaEmision?: string;
      rncComprador?: string;
      razonSocialComprador?: string;
      montoGravadoTotal?: number;
      montoGravadoI1?: number;
      montoExento?: number;
      totalItbis1?: number;
      tipoIngresos?: string;
      tipoPago?: string;
    },
  ): string {
    const cleanEncf = (eNcf || '').trim().toUpperCase();
    const cleanRncEmisor = sanitizeRnc(rncEmisor);
    const razonSocialEmisor = (extraOptions?.razonSocialEmisor || 'SUMTECH TELECOM S.R.L.').substring(0, 150);
    const fechaEmisionStr = extraOptions?.fechaEmision || this.formatDateDgii();
    const tipoIngresos = extraOptions?.tipoIngresos || '01';
    const tipoPago = extraOptions?.tipoPago || '1';

    // Comprador conforme a rfce-32.xsd (nodo obligatorio, hijos opcionales)
    let compradorXml = '<Comprador>';
    const cleanRncComprador = sanitizeRnc(extraOptions?.rncComprador);
    if (cleanRncComprador.length === 9 || cleanRncComprador.length === 11) {
      compradorXml += `<RNCComprador>${cleanRncComprador}</RNCComprador>`;
    }
    const razonSocialComprador = (extraOptions?.razonSocialComprador || 'Consumidor Final').substring(0, 150);
    compradorXml += `<RazonSocialComprador>${this.escapeXml(razonSocialComprador)}</RazonSocialComprador>`;
    compradorXml += '</Comprador>';

    // Totales conforme a rfce-32.xsd:
    // MontoGravadoTotal?, MontoGravadoI1?, MontoGravadoI2?, MontoGravadoI3?, MontoExento?, TotalITBIS?, TotalITBIS1?, TotalITBIS2?, TotalITBIS3?, MontoImpuestoAdicional?, ImpuestosAdicionales?, MontoTotal, MontoNoFacturable?, MontoPeriodo?
    const itbisVal = itbisTotal ?? 0;
    const montoTotalVal = montoTotal ?? 0;
    const montoGravadoVal = extraOptions?.montoGravadoTotal ?? (itbisVal > 0 ? Number((montoTotalVal / 1.18).toFixed(2)) : 0);
    const montoExentoVal = extraOptions?.montoExento ?? (itbisVal === 0 && montoGravadoVal === 0 ? montoTotalVal : 0);

    let totalesXml = '<Totales>';
    if (montoGravadoVal > 0) {
      totalesXml += `<MontoGravadoTotal>${this.formatDecimal(montoGravadoVal)}</MontoGravadoTotal>`;
      totalesXml += `<MontoGravadoI1>${this.formatDecimal(extraOptions?.montoGravadoI1 ?? montoGravadoVal)}</MontoGravadoI1>`;
    }
    if (montoExentoVal > 0) {
      totalesXml += `<MontoExento>${this.formatDecimal(montoExentoVal)}</MontoExento>`;
    }
    if (itbisVal > 0) {
      totalesXml += `<TotalITBIS>${this.formatDecimal(itbisVal)}</TotalITBIS>`;
      totalesXml += `<TotalITBIS1>${this.formatDecimal(extraOptions?.totalItbis1 ?? itbisVal)}</TotalITBIS1>`;
    }
    totalesXml += `<MontoTotal>${this.formatDecimal(montoTotalVal)}</MontoTotal>`;
    totalesXml += '</Totales>';

    // Código de seguridad (exactamente 6 caracteres alfanuméricos en CodigoSeguridadeCF)
    // IMPORTANTE: NO convertir a uppercase — debe coincidir exactamente con los primeros
    // 6 caracteres del SignatureValue del e-CF base firmado (case-sensitive).
    const rawSec = (codigoSeguridad || '').replace(/[^a-zA-Z0-9]/g, '');
    const cleanSec = (rawSec + 'XXXXXX').substring(0, 6);

    return (
      `<RFCE>` +
        `<Encabezado>` +
          `<Version>1.0</Version>` +
          `<IdDoc>` +
            `<TipoeCF>32</TipoeCF>` +
            `<eNCF>${cleanEncf}</eNCF>` +
            `<TipoIngresos>${tipoIngresos}</TipoIngresos>` +
            `<TipoPago>${tipoPago}</TipoPago>` +
          `</IdDoc>` +
          `<Emisor>` +
            `<RNCEmisor>${cleanRncEmisor}</RNCEmisor>` +
            `<RazonSocialEmisor>${this.escapeXml(razonSocialEmisor)}</RazonSocialEmisor>` +
            `<FechaEmision>${fechaEmisionStr}</FechaEmision>` +
          `</Emisor>` +
          compradorXml +
          totalesXml +
          `<CodigoSeguridadeCF>${cleanSec}</CodigoSeguridadeCF>` +
        `</Encabezado>` +
      `</RFCE>`
    );
  }

  /**
   * Genera el XML de Aprobación Comercial (ACECF) para acuse o rechazo de facturas de compras.
   * Orden y nombres de campo verificados contra el XSD oficial de la DGII
   * (acecf.xsd:6-18) — RNCEmisor, eNCF, FechaEmision y MontoTotal (del e-CF
   * original) van ANTES de RNCComprador, el estado se llama "Estado" (no
   * "EstadoAprobacion"), y el motivo de rechazo es "DetalleMotivoRechazo".
   */
  generateAcecfXml(input: AcecfGenerationInput): string {
    const fechaHoraStr = this.normalizeDateTimeStr(input.fechaAprobacion);
    const fechaEmisionEcfStr = this.normalizeDateStr(input.fechaEmisionEcf);
    const cleanRncEmisor = sanitizeRnc(input.rncEmisor);
    const cleanRncComprador = sanitizeRnc(input.rncComprador);
    return (
      `<ACECF>` +
        `<DetalleAprobacionComercial>` +
          `<Version>1.0</Version>` +
          `<RNCEmisor>${cleanRncEmisor}</RNCEmisor>` +
          `<eNCF>${this.escapeXml(input.eNcf)}</eNCF>` +
          `<FechaEmision>${fechaEmisionEcfStr}</FechaEmision>` +
          `<MontoTotal>${this.formatDecimal(input.montoTotalEcf)}</MontoTotal>` +
          `<RNCComprador>${cleanRncComprador}</RNCComprador>` +
          `<Estado>${input.estadoAprobacion}</Estado>` +
          (input.estadoAprobacion === 2 && input.comentario ? `<DetalleMotivoRechazo>${this.escapeXml(input.comentario)}</DetalleMotivoRechazo>` : '') +
          `<FechaHoraAprobacionComercial>${fechaHoraStr}</FechaHoraAprobacionComercial>` +
        `</DetalleAprobacionComercial>` +
      `</ACECF>`
    );
  }

  /**
   * Genera el XML de Anulación de Secuencias (ANECF) para anular rangos e-NCF no utilizados
   */
  generateAnecfXml(input: AnecfGenerationInput): string {
    const fechaHoraStr = this.formatDateTimeDgii();
    const cleanRncEmisor = sanitizeRnc(input.rncEmisor);
    return (
      `<ANECF>` +
        `<DetalleAnulacion>` +
          `<Version>1.0</Version>` +
          `<RNCEmisor>${cleanRncEmisor}</RNCEmisor>` +
          `<TipoeCF>${this.escapeXml(input.tipoComprobante)}</TipoeCF>` +
          `<eNCFDesde>${this.escapeXml(input.secuenciaDesde)}</eNCFDesde>` +
          `<eNCFHasta>${this.escapeXml(input.secuenciaHasta)}</eNCFHasta>` +
          `<MotivoAnulacion>${this.escapeXml(input.motivo || 'Error de secuencia o daño físico')}</MotivoAnulacion>` +
          `<FechaHoraAnulacion>${fechaHoraStr}</FechaHoraAnulacion>` +
        `</DetalleAnulacion>` +
      `</ANECF>`
    );
  }

  /**
   * Genera el XML de Acuse de Recibo (ARECF) conforme a la especificación oficial DGII
   */
  /**
   * Genera el Acuse de Recibo (ARECF) exactamente según arecf.xsd oficial de
   * la DGII: envoltorio <DetalleAcusedeRecibo>, <RNCEmisor>/<RNCComprador> en
   * mayúsculas, <Estado> (no "EstadoRespuesta"), y <FechaHoraAcuseRecibo>
   * combinando fecha+hora en un solo nodo "dd-MM-yyyy HH:mm:ss", y SIN
   * namespace en la raíz (arecf.xsd no declara targetNamespace) — la versión
   * anterior usaba nombres de nodo inventados (<Header>, <RncEmisor>,
   * <EstadoRespuesta>, <FechaEmision>/<HoraEmision> separados) y un
   * xmlns="http://www.dgii.gov.do/ecf" que el esquema real no espera, por lo
   * que la DGII rechazaba el acuse como "no válido" en toda prueba de
   * recepción B2B (ver certificación 2026-10-07).
   */
  generateArecfXml(input: ArecfGenerationInput): string {
    const fechaHoraAcuseStr = this.formatDateTimeDgii(input.fechaEmision || new Date());
    const cleanRncEmisor = sanitizeRnc(input.rncEmisor);
    const cleanRncComprador = sanitizeRnc(input.rncComprador);

    let motivoNoRecibidoXml = '';
    if (input.estadoRespuesta === 1 && input.codigoMotivoNoRecibido) {
      motivoNoRecibidoXml = `<CodigoMotivoNoRecibido>${input.codigoMotivoNoRecibido}</CodigoMotivoNoRecibido>`;
    }

    return (
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<ARECF>` +
        `<DetalleAcusedeRecibo>` +
          `<Version>1.0</Version>` +
          `<RNCEmisor>${cleanRncEmisor}</RNCEmisor>` +
          `<RNCComprador>${cleanRncComprador}</RNCComprador>` +
          `<eNCF>${this.escapeXml(input.eNcf)}</eNCF>` +
          `<Estado>${input.estadoRespuesta}</Estado>` +
          motivoNoRecibidoXml +
          `<FechaHoraAcuseRecibo>${fechaHoraAcuseStr}</FechaHoraAcuseRecibo>` +
        `</DetalleAcusedeRecibo>` +
      `</ARECF>`
    );
  }
}
