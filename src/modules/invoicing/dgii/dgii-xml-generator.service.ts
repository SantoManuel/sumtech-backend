import { Injectable } from '@nestjs/common';
import { DgiiConfig, DEFAULT_DGII_CONFIG } from './dgii-config.interface';

export interface EcfItemInput {
  numeroLinea: number;
  nombreItem: string;
  indicadorBienoServicio: '1' | '2'; // 1 = Bien, 2 = Servicio
  indicadorFacturacion: '1' | '2' | '3' | '4'; // 1 = 18%, 2 = 16%, 3 = 0%, 4 = Exento
  cantidad: number;
  precioUnitario: number;
  montoItem: number;
  itbisRate?: number;
  itbisMonto?: number;
  // Código UnidadMedidaType (XSD), campo opcional (minOccurs="0"). No existe un
  // código dedicado a "servicio" en el catálogo DGII — solo se envía para bienes
  // físicos (ej. 43 = UND/Unidad); se omite para servicios en vez de forzar un
  // código que no representa correctamente un intangible.
  unidadMedida?: number;
  // Códigos CodificacionTipoImpuestosType (XSD) que aplican a este ítem (máx. 2),
  // ej. ['002'] = Contribución al Desarrollo de las Telecomunicaciones (CDT), Ley 153-98 Art. 45.
  tiposImpuestoAdicional?: string[];
}

export interface EcfImpuestoAdicionalInput {
  tipoImpuesto: string; // CodificacionTipoImpuestosType, ej. '002' = CDT
  tasa: number; // Porcentaje (ej. 2 para 2%, no 0.02)
  monto: number;
}

export interface EcfGenerationInput {
  ncfType: 'E31' | 'E32' | 'E33' | 'E34' | 'E41' | 'E43' | 'E44' | 'E45' | 'E46' | 'E47' | 'B01' | 'B02';
  eNcf: string;
  fechaEmision?: Date;
  fechaVencimientoSecuencia?: string; // dd-MM-yyyy
  tipoPago?: '1' | '2' | '3'; // 1=Efectivo/Contado, 2=Credito, 3=Tarjeta/Transferencia
  
  // Datos del Comprador
  rncComprador?: string;
  razonSocialComprador: string;
  correoComprador?: string;
  direccionComprador?: string;

  // Modificación (para notas de crédito/débito E33/E34)
  ncfModificado?: string;
  fechaNcfModificado?: string;
  codigoModificacion?: '1' | '2' | '3' | '4' | '5';
  razonModificacion?: string;
  // '0' = Nota de Crédito emitida <=30 días calendario después de la factura
  // original; '1' = emitida después de 30 días (XSD IndicadorNotaCreditoType).
  indicadorNotaCredito?: '0' | '1';

  // Líneas de detalle
  items: EcfItemInput[];

  // Impuestos adicionales a nivel de comprobante (ej. CDT telecomunicaciones)
  impuestosAdicionales?: EcfImpuestoAdicionalInput[];
}

export interface AcecfGenerationInput {
  rncEmisor: string;
  rncComprador: string;
  eNcf: string;
  estadoAprobacion: 1 | 2; // 1 = Aprobado, 2 = Rechazado
  comentario?: string;
  fechaAprobacion?: Date;
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
   * Formatea solo la hora para el nodo HoraEmision (HH:mm:ss)
   */
  private formatTimeDgii(date: Date = new Date()): string {
    const hr = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const sec = String(date.getSeconds()).padStart(2, '0');
    return `${hr}:${min}:${sec}`;
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
      const lineTotal = item.montoItem || (item.cantidad * item.precioUnitario);
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

    // 2. Construcción de Secciones XML
    // Contenedor IdDoc
    let idDocXml = 
      `<IdDoc>` +
        `<TipoeCF>${tipoDoc}</TipoeCF>` +
        `<eNCF>${this.escapeXml(input.eNcf)}</eNCF>`;

    if (usesNcfExpiryDate(input.ncfType)) {
      const fechaVenc = input.fechaVencimientoSecuencia || '31-12-2026';
      idDocXml += `<FechaVencimientoSecuencia>${fechaVenc}</FechaVencimientoSecuencia>`;
    }

    if (tipoDoc === '34') {
      idDocXml += `<IndicadorNotaCredito>${input.indicadorNotaCredito ?? '1'}</IndicadorNotaCredito>`;
    }

    if (montoGravadoTotal > 0) {
      idDocXml += `<IndicadorMontoGravado>1</IndicadorMontoGravado>`;
    }

    idDocXml += 
        `<TipoIngresos>01</TipoIngresos>` +
        `<TipoPago>${input.tipoPago || '1'}</TipoPago>` +
      `</IdDoc>`;

    // Contenedor Emisor
    let emisorXml = 
      `<Emisor>` +
        `<RNCEmisor>${this.escapeXml(config.rncEmisor)}</RNCEmisor>` +
        `<RazonSocialEmisor>${this.escapeXml(config.razonSocialEmisor)}</RazonSocialEmisor>`;

    if (config.nombreComercial) {
      emisorXml += `<NombreComercial>${this.escapeXml(config.nombreComercial)}</NombreComercial>`;
    }

    emisorXml += 
        `<DireccionEmisor>${this.escapeXml(config.direccionEmisor || 'Santo Domingo, Rep. Dom.')}</DireccionEmisor>`;

    if (config.municipioEmisor) {
      emisorXml += `<Municipio>${this.escapeXml(config.municipioEmisor)}</Municipio>`;
    }
    if (config.provinciaEmisor) {
      emisorXml += `<Provincia>${this.escapeXml(config.provinciaEmisor)}</Provincia>`;
    }
    if (config.correoEmisor) {
      emisorXml += `<CorreoEmisor>${this.escapeXml(config.correoEmisor)}</CorreoEmisor>`;
    }
    if (config.telefonoEmisor) {
      emisorXml += `<TablaTelefonoEmisor><TelefonoEmisor>${this.escapeXml(config.telefonoEmisor)}</TelefonoEmisor></TablaTelefonoEmisor>`;
    }
    if (config.webSite) {
      emisorXml += `<WebSite>${this.escapeXml(config.webSite)}</WebSite>`;
    }

    emisorXml += `<FechaEmision>${fechaEmisionStr}</FechaEmision></Emisor>`;

    // Contenedor Comprador
    let compradorXml = `<Comprador>`;
    const rawRnc = (input.rncComprador || '').replace(/\D/g, '');
    if (rawRnc.length === 9 || rawRnc.length === 11) {
      compradorXml += `<RNCComprador>${rawRnc}</RNCComprador>`;
    }
    compradorXml += `<RazonSocialComprador>${this.escapeXml(input.razonSocialComprador || 'Consumidor Final')}</RazonSocialComprador>`;
    if (input.correoComprador) {
      compradorXml += `<CorreoComprador>${this.escapeXml(input.correoComprador)}</CorreoComprador>`;
    }
    if (input.direccionComprador) {
      compradorXml += `<DireccionComprador>${this.escapeXml(input.direccionComprador)}</DireccionComprador>`;
    }
    compradorXml += `</Comprador>`;

    // Contenedor Totales
    let totalesXml = `<Totales>`;
    if (montoGravadoTotal > 0) {
      totalesXml += `<MontoGravadoTotal>${this.formatDecimal(montoGravadoTotal)}</MontoGravadoTotal>`;
      if (montoGravadoI1 > 0) {
        totalesXml += `<MontoGravadoI1>${this.formatDecimal(montoGravadoI1)}</MontoGravadoI1>`;
      }
      if (montoGravadoI2 > 0) {
        totalesXml += `<MontoGravadoI2>${this.formatDecimal(montoGravadoI2)}</MontoGravadoI2>`;
      }
    }
    if (montoExento > 0) {
      totalesXml += `<MontoExento>${this.formatDecimal(montoExento)}</MontoExento>`;
    }

    if (montoGravadoI1 > 0) {
      totalesXml += `<ITBIS1>18</ITBIS1>`;
    }
    if (montoGravadoI2 > 0) {
      totalesXml += `<ITBIS2>16</ITBIS2>`;
    }

    if (totalITBIS > 0) {
      totalesXml += `<TotalITBIS>${this.formatDecimal(totalITBIS)}</TotalITBIS>`;
      if (totalITBIS1 > 0) {
        totalesXml += `<TotalITBIS1>${this.formatDecimal(totalITBIS1)}</TotalITBIS1>`;
      }
      if (totalITBIS2 > 0) {
        totalesXml += `<TotalITBIS2>${this.formatDecimal(totalITBIS2)}</TotalITBIS2>`;
      }
    }

    if (montoImpuestoAdicionalTotal > 0) {
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

    totalesXml += `<MontoTotal>${this.formatDecimal(montoTotal)}</MontoTotal></Totales>`;

    // Contenedor DetallesItems
    let itemsXml = `<DetallesItems>`;
    input.items.forEach((item, index) => {
      const lineNum = item.numeroLinea || (index + 1);
      const lineTotal = item.montoItem || (item.cantidad * item.precioUnitario);

      let tablaImpuestoAdicionalXml = '';
      if (item.tiposImpuestoAdicional && item.tiposImpuestoAdicional.length > 0) {
        tablaImpuestoAdicionalXml =
          `<TablaImpuestoAdicional>` +
          item.tiposImpuestoAdicional
            .slice(0, 2)
            .map((tipo) => `<ImpuestoAdicional><TipoImpuesto>${this.escapeXml(tipo)}</TipoImpuesto></ImpuestoAdicional>`)
            .join('') +
          `</TablaImpuestoAdicional>`;
      }

      itemsXml +=
        `<Item>` +
          `<NumeroLinea>${lineNum}</NumeroLinea>` +
          `<IndicadorFacturacion>${item.indicadorFacturacion || '1'}</IndicadorFacturacion>` +
          `<NombreItem>${this.escapeXml(item.nombreItem)}</NombreItem>` +
          `<IndicadorBienoServicio>${item.indicadorBienoServicio || '2'}</IndicadorBienoServicio>` +
          `<CantidadItem>${this.formatDecimal(item.cantidad)}</CantidadItem>` +
          (item.unidadMedida ? `<UnidadMedida>${item.unidadMedida}</UnidadMedida>` : '') +
          `<PrecioUnitarioItem>${this.formatDecimal(item.precioUnitario)}</PrecioUnitarioItem>` +
          tablaImpuestoAdicionalXml +
          `<MontoItem>${this.formatDecimal(lineTotal)}</MontoItem>` +
        `</Item>`;
    });
    itemsXml += `</DetallesItems>`;

    // Información de Referencia (solo si es Nota de Crédito/Débito E33/E34)
    let infoRefXml = '';
    if ((tipoDoc === '33' || tipoDoc === '34') && input.ncfModificado) {
      infoRefXml = 
        `<InformacionReferencia>` +
          `<NCFModificado>${this.escapeXml(input.ncfModificado)}</NCFModificado>` +
          `<FechaNCFModificado>${input.fechaNcfModificado || '01-01-2026'}</FechaNCFModificado>` +
          `<CodigoModificacion>${input.codigoModificacion || '1'}</CodigoModificacion>` +
          `<RazonModificacion>${this.escapeXml(input.razonModificacion || 'Ajuste de Facturación')}</RazonModificacion>` +
        `</InformacionReferencia>`;
    }

    // Documento Raíz ECF
    return (
      `<ECF>` +
        `<Encabezado>` +
          `<Version>1.0</Version>` +
          idDocXml +
          emisorXml +
          compradorXml +
          totalesXml +
        `</Encabezado>` +
        itemsXml +
        infoRefXml +
        `<FechaHoraFirma>${fechaHoraFirmaStr}</FechaHoraFirma>` +
      `</ECF>`
    );
  }

  /**
   * Genera el XML del Resumen de Factura de Consumo Electrónica (RFCE) para e-CF tipo 32 < RD$ 250,000
   */
  generateRfceXml(eNcf: string, rncEmisor: string, montoTotal: number, itbisTotal: number, codigoSeguridad: string): string {
    const fechaEmisionStr = this.formatDateDgii();
    return (
      `<RFCE>` +
        `<Encabezado>` +
          `<Version>1.0</Version>` +
          `<RNCEmisor>${this.escapeXml(rncEmisor)}</RNCEmisor>` +
          `<eNCF>${this.escapeXml(eNcf)}</eNCF>` +
          `<FechaEmision>${fechaEmisionStr}</FechaEmision>` +
          `<MontoTotal>${this.formatDecimal(montoTotal)}</MontoTotal>` +
          `<TotalITBIS>${this.formatDecimal(itbisTotal)}</TotalITBIS>` +
          `<CodigoSeguridad>${this.escapeXml(codigoSeguridad)}</CodigoSeguridad>` +
        `</Encabezado>` +
      `</RFCE>`
    );
  }

  /**
   * Genera el XML de Aprobación Comercial (ACECF) para acuse o rechazo de facturas de compras
   */
  generateAcecfXml(input: AcecfGenerationInput): string {
    const fechaHoraStr = this.formatDateTimeDgii(input.fechaAprobacion || new Date());
    return (
      `<ACECF>` +
        `<DetalleAprobacionComercial>` +
          `<Version>1.0</Version>` +
          `<RNCEmisor>${this.escapeXml(input.rncEmisor)}</RNCEmisor>` +
          `<RNCComprador>${this.escapeXml(input.rncComprador)}</RNCComprador>` +
          `<eNCF>${this.escapeXml(input.eNcf)}</eNCF>` +
          `<EstadoAprobacion>${input.estadoAprobacion}</EstadoAprobacion>` +
          (input.comentario ? `<Comentario>${this.escapeXml(input.comentario)}</Comentario>` : '') +
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
    return (
      `<ANECF>` +
        `<DetalleAnulacion>` +
          `<Version>1.0</Version>` +
          `<RNCEmisor>${this.escapeXml(input.rncEmisor)}</RNCEmisor>` +
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
  generateArecfXml(input: ArecfGenerationInput): string {
    const fechaEmisionStr = this.formatDateDgii(input.fechaEmision || new Date());
    const horaEmisionStr = this.formatTimeDgii(input.fechaEmision || new Date());

    let motivoNoRecibidoXml = '';
    if (input.estadoRespuesta === 1 && input.codigoMotivoNoRecibido) {
      motivoNoRecibidoXml = `<CodigoMotivoNoRecibido>${input.codigoMotivoNoRecibido}</CodigoMotivoNoRecibido>`;
    }

    return (
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<ARECF xmlns="http://www.dgii.gov.do/ecf">` +
        `<Header>` +
          `<Version>1.0</Version>` +
          `<RncEmisor>${this.escapeXml(input.rncEmisor)}</RncEmisor>` +
          `<RncComprador>${this.escapeXml(input.rncComprador)}</RncComprador>` +
          `<eNCF>${this.escapeXml(input.eNcf)}</eNCF>` +
          `<EstadoRespuesta>${input.estadoRespuesta}</EstadoRespuesta>` +
          motivoNoRecibidoXml +
          `<FechaEmision>${fechaEmisionStr}</FechaEmision>` +
          `<HoraEmision>${horaEmisionStr}</HoraEmision>` +
        `</Header>` +
      `</ARECF>`
    );
  }
}
