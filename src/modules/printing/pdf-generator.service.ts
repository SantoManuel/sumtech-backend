import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { CONTRACT_CLAUSES_PLACEHOLDER } from './contract-clauses.constant';
import { ClientsListPdfData, CompanyPdfInfo, ContractPdfData, InvoiceReceiptMetadata } from './pdf-generator.types';

const NCF_TYPE_LABELS: Record<string, string> = {
  E31: 'FACTURA DE CRÉDITO FISCAL ELECTRÓNICA',
  E32: 'FACTURA DE CONSUMO ELECTRÓNICA',
  E33: 'NOTA DE DÉBITO ELECTRÓNICA',
  E34: 'NOTA DE CRÉDITO ELECTRÓNICA',
  E41: 'COMPROBANTE DE COMPRAS ELECTRÓNICO',
  E43: 'COMPROBANTE PARA GASTOS MENORES ELECTRÓNICO',
  E44: 'COMPROBANTE REGÍMENES ESPECIALES ELECTRÓNICO',
  E45: 'COMPROBANTE GUBERNAMENTAL ELECTRÓNICO',
  E46: 'COMPROBANTE PARA EXPORTACIONES ELECTRÓNICO',
  E47: 'COMPROBANTE PARA PAGOS AL EXTERIOR ELECTRÓNICO',
  '31': 'FACTURA DE CRÉDITO FISCAL ELECTRÓNICA',
  '32': 'FACTURA DE CONSUMO ELECTRÓNICA',
  '33': 'NOTA DE DÉBITO ELECTRÓNICA',
  '34': 'NOTA DE CRÉDITO ELECTRÓNICA',
  '41': 'COMPROBANTE DE COMPRAS ELECTRÓNICO',
  '43': 'COMPROBANTE PARA GASTOS MENORES ELECTRÓNICO',
  '44': 'COMPROBANTE REGÍMENES ESPECIALES ELECTRÓNICO',
  '45': 'COMPROBANTE GUBERNAMENTAL ELECTRÓNICO',
  '46': 'COMPROBANTE PARA EXPORTACIONES ELECTRÓNICO',
  '47': 'COMPROBANTE PARA PAGOS AL EXTERIOR ELECTRÓNICO',
  B01: 'FACTURA DE CRÉDITO FISCAL',
  B02: 'FACTURA DE CONSUMO FINAL',
  B03: 'NOTA DE DÉBITO',
  B04: 'NOTA DE CRÉDITO',
  B11: 'COMPROBANTE DE COMPRAS',
  B13: 'GASTOS MENORES',
  B14: 'REGÍMENES ESPECIALES',
  B15: 'GUBERNAMENTAL',
  B16: 'EXPORTACIONES',
  B17: 'PAGOS AL EXTERIOR',
  PROFORMA: 'AVISO DE COBRO / FACTURA PROFORMA',
  AVISO: 'AVISO DE COBRO / FACTURA PROFORMA',
  AVISO_COBRO: 'AVISO DE COBRO / FACTURA PROFORMA',
  'AVISO DE COBRO': 'AVISO DE COBRO / FACTURA PROFORMA',
};

function getNcfTypeLabel(type?: string): string {
  if (!type) return 'COMPROBANTE FISCAL ELECTRÓNICO (e-CF)';
  const clean = type.trim().toUpperCase();
  return NCF_TYPE_LABELS[clean] || NCF_TYPE_LABELS[`E${clean}`] || 'COMPROBANTE FISCAL ELECTRÓNICO (e-CF)';
}

/**
 * Conforme a la normativa oficial de la DGII (Decreto 254-06, Norma General 06-2018):
 * - La Factura de Crédito Fiscal (E31 / B01) lleva obligatoriamente Fecha de Vencimiento de Secuencia
 *   (vigencia máxima de hasta 2 años calendario: vencen el 31 de diciembre del año siguiente a su solicitud).
 * - La Factura de Consumo (E32 / B02) está EXENTA de fecha de vencimiento; sus secuencias no caducan por calendario.
 * - Las Notas de Crédito (E34 / B04) tampoco llevan vencimiento de secuencia propio.
 */
function shouldShowNcfExpiry(ncfType?: string, ncfNumber?: string): boolean {
  const type = (ncfType || '').toUpperCase().replace(/^E/, '');
  const num = (ncfNumber || '').toUpperCase().replace(/^E/, '');
  const docType = type || num.slice(0, 2);
  if (docType === '32' || docType === '02' || docType === '34' || docType === '04' || docType.includes('AVISO') || docType.includes('PROFORMA')) {
    return false;
  }
  return true;
}

function buildDgiiQrUrl(metadata: InvoiceReceiptMetadata): string {
  // Si la factura ya trae una URL oficial que contenga codigoseguridad o consultatimbrefc (no la URL dummy corta)
  if (
    metadata.invoice.qrCodeUrl &&
    !metadata.invoice.qrCodeUrl.includes('/consulta?encf=') &&
    (metadata.invoice.qrCodeUrl.includes('codigoseguridad') || metadata.invoice.qrCodeUrl.includes('consultatimbrefc'))
  ) {
    return metadata.invoice.qrCodeUrl;
  }
  const eNcf = metadata.invoice.ncfNumber || '';
  const rncEmisor = (metadata.company.rnc || '').replace(/\D/g, '');
  const rncComprador = (metadata.client.docNumber || '').replace(/\D/g, '');
  const montoTotal = Number(metadata.sale.grandTotal || 0);
  const securityCode = metadata.invoice.securityCode || '000000';
  const issuedAt = metadata.invoice.issuedAt instanceof Date ? metadata.invoice.issuedAt : new Date(metadata.invoice.issuedAt || Date.now());
  const env = 'certecf';
  const fechaEmiStr = `${String(issuedAt.getDate()).padStart(2, '0')}-${String(issuedAt.getMonth() + 1).padStart(2, '0')}-${issuedAt.getFullYear()}`;
  const fechaFirStr = `${fechaEmiStr} ${String(issuedAt.getHours()).padStart(2, '0')}:${String(issuedAt.getMinutes()).padStart(2, '0')}:${String(issuedAt.getSeconds()).padStart(2, '0')}`;
  const montoStr = montoTotal.toFixed(2);

  const isConsumoMenor = eNcf.startsWith('E32') && montoTotal < 250000;
  if (isConsumoMenor) {
    // QR del Resumen de Factura de Consumo (RFCE) tipo 32 < RD$250,000:
    // host `fc.dgii.gov.do`, ruta `/consultatimbrefc`, parámetros:
    // RNCEmisor, ENCF, MontoTotal, CodigoSeguridad.
    return `https://fc.dgii.gov.do/${env}/consultatimbrefc?rncemisor=${encodeURIComponent(rncEmisor)}&encf=${encodeURIComponent(eNcf)}&montototal=${encodeURIComponent(montoStr)}&codigoseguridad=${encodeURIComponent(securityCode)}`;
  }

  let compradorQuery = '';
  if (rncComprador && !eNcf.startsWith('E43') && !eNcf.startsWith('E47')) {
    compradorQuery = `&rnccomprador=${encodeURIComponent(rncComprador)}`;
  }

  return `https://ecf.dgii.gov.do/${env}/consultatimbre?rncemisor=${encodeURIComponent(rncEmisor)}${compradorQuery}&encf=${encodeURIComponent(eNcf)}&fechaemision=${encodeURIComponent(fechaEmiStr)}&montototal=${encodeURIComponent(montoStr)}&fechafirma=${encodeURIComponent(fechaFirStr)}&codigoseguridad=${encodeURIComponent(securityCode)}`;
}

/**
 * Parámetros de render del Código QR oficial de la DGII (Representación Impresa A4
 * y ticket 80 mm). Son ÚNICOS para ambos formatos y no deben "reducirse" para
 * aligerar el PDF: el tamaño físico del QR en la página lo fija el layout
 * (90 pt en A4, 85 pt en 80 mm), no la resolución del mapa de bits embebido.
 *
 * POR QUÉ ESTOS VALORES (no usar width:110 / margin:1 como antes):
 *
 * 1. `margin: 4` — La norma ISO/IEC 18004 exige 4 módulos de zona de silencio
 *    ("quiet zone") alrededor del símbolo. Con `margin: 1` el lector de códigos
 *    no logra localizar el contorno ni determinar la versión del símbolo, y la
 *    lectura falla o sale parcial.
 *
 * 2. `width: 400` — La URL completa del QR de la DGII (con rncemisor,
 *    rnccomprador, encf, fechaemision, montototal, fechafirma y codigoseguridad)
 *    mide ~211 bytes, lo que obliga a un QR de versión 10 = 57x57 módulos.
 *    Antes se rasterizaba ese símbolo de 57x57 en un PNG de 110x110 px, es decir
 *    1.86 px POR MÓDULO: muy por debajo del mínimo de ~4 px/módulo que necesitan
 *    los lectores. Consecuencia observada: al abrir o imprimir el PDF (donde el
 *    visor reescala el PNG de 110 px hacia los 90 pt con suavizado) el lector
 *    perdía sincronía en la región de datos y devolvía la URL truncada justo
 *    antes del primer %20, es decir sin la hora de `fechafirma` y sin
 *    `codigoseguridad` — la URL quedaba inservible para consultar el timbre en
 *    el portal de la DGII.
 *    400 px sobre 57 módulos ≈ 6.1 px/módulo: por encima del umbral de 4 y lo
 *    bastante holgado para sobrevivir a la impresión a 300 DPI (el QR de 90 pt
 *    del A4 sale a 400/1.25in = 320 DPI). No se sube más (600 px) porque la RI
 *    se genera en PDF sin compresión y el PNG viaja crudo dentro: cada aumento
 *    de resolución infla el archivo y el tiempo de render sin aportar legibilidad.
 *
 * 3. `errorCorrectionLevel: 'M'` — Se fija explícitamente para que el resultado
 *    no dependa del valor por defecto de la librería. 'M' es el nivel que la
 *    práctica DGII exige en la RI y aporta redundancia ante impresión de baja
 *    calidad; no se baja a 'L' porque, aunque permitiría caer a versión 9
 *    (53x53 módulos), se perdería tolerancia a manchas y roces en el papel.
 *
 * Validado decodificando el PNG generado con ZXing: a 110 px/margin:1 la lectura
 * falla en cuanto el símbolo se reescala (impresión o captura de pantalla);
 * con 400 px/margin:4 lee la URL completa e idéntica a 120, 150, 200, 300 y 400 px.
 */
const DGII_QR_RENDER_OPTS = {
  type: 'png' as const,
  width: 400,
  margin: 4,
  errorCorrectionLevel: 'M' as const,
};

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  PENDING_INSTALL: 'Pendiente de Instalación',
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  TERMINATED: 'Terminado',
};

function formatCurrency(value: number): string {
  return `RD$ ${Number(value || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Sin prefijo "RD$": en el modelo de Representación Impresa aceptado por la
// DGII, solo el TOTAL A PAGAR lleva el prefijo de moneda — los ítems y los
// subtotales del recuadro de totales van con el monto plano.
function formatNumber(value: number): string {
  return Number(value || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value: Date | string | undefined): string {
  if (!value) return 'N/A';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(value: Date | string | undefined): string {
  if (!value) return 'N/A';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return `${formatDate(date)} ${date.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Genera los PDF de Representación Impresa (RI) de facturas e-CF en formato A4
 * conforme al layout de las muestras oficiales de la DGII, y el PDF de contrato
 * de servicios. Es agnóstico al origen de los datos (InvoicingService/ClientsService
 * arman las proyecciones InvoiceReceiptMetadata/ContractPdfData).
 */
@Injectable()
export class PdfGeneratorService {
  private streamToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }

  private drawCompanyHeader(doc: PDFKit.PDFDocument, company: CompanyPdfInfo, x: number, y: number, width: number) {
    const razonSocialTrim = (company.razonSocial || '').trim();
    const nombreComercialTrim = (company.nombreComercial || '').trim();
    doc.font('Helvetica-Bold').fontSize(14).text(razonSocialTrim, x, y, { width });
    if (nombreComercialTrim && nombreComercialTrim !== razonSocialTrim) {
      doc.font('Helvetica-Bold').fontSize(11).text(nombreComercialTrim, x, doc.y, { width });
    }
    doc.font('Helvetica-Bold').fontSize(9).text(`RNC: ${company.rnc}`, x, doc.y + 2, { width });
    doc.font('Helvetica').fontSize(8.5);
    if (company.direccion) doc.text(company.direccion, x, doc.y + 2, { width });
    const contactLine = [company.telefono ? `Tel: ${company.telefono}` : null, company.correo].filter(Boolean).join(' | ');
    if (contactLine) doc.text(contactLine, x, doc.y + 2, { width });
  }

  async generateInvoiceA4Pdf(metadata: InvoiceReceiptMetadata): Promise<Buffer> {
    const doc = new (PDFDocument as any)({ size: 'A4', margin: 40, compress: false }) as PDFKit.PDFDocument;
    const pageWidth = doc.page.width;
    const marginX = 40;
    const contentWidth = pageWidth - marginX * 2;

    // Encabezado: empresa (izquierda) + recuadro tipo de comprobante/e-NCF (derecha)
    const headerTop = 40;
    this.drawCompanyHeader(doc, metadata.company, marginX, headerTop, 300);

    const isProforma = !!metadata.invoice.isProforma ||
      (metadata.invoice.ncfType || '').toUpperCase().includes('AVISO') ||
      (metadata.invoice.ncfType || '').toUpperCase().includes('PROFORMA') ||
      metadata.sale.paymentMethod === 'PENDIENTE DE PAGO' ||
      (metadata.invoice.ncfNumber || '').startsWith('AVISO-');

    const boxX = marginX + 310;
    const boxWidth = contentWidth - 310;
    doc.rect(boxX, headerTop, boxWidth, 70).stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(isProforma ? 'AVISO DE COBRO / FACTURA PROFORMA' : getNcfTypeLabel(metadata.invoice.ncfType), boxX + 8, headerTop + 8, {
        width: boxWidth - 16,
      });
    doc.font('Helvetica-Bold').fontSize(11).text(
      isProforma ? `No. Doc: ${metadata.invoice.ncfNumber || 'AVISO'}` : `e-NCF: ${metadata.invoice.ncfNumber || 'N/A'}`,
      boxX + 8,
      doc.y + 4,
      { width: boxWidth - 16 },
    );
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .text(`Fecha Emisión: ${formatDate(metadata.invoice.issuedAt)}`, boxX + 8, doc.y + 4, { width: boxWidth - 16 });
    if (isProforma) {
      doc.text(`Fecha Vencimiento: ${formatDate(metadata.sale.dueDate)}`, boxX + 8, doc.y + 1, { width: boxWidth - 16 });
    } else if (metadata.invoice.ncfExpiryDate && shouldShowNcfExpiry(metadata.invoice.ncfType, metadata.invoice.ncfNumber)) {
      // Vencimiento de la secuencia de NCF (ya viene en formato dd-MM-yyyy desde
      // EcfSequenceEntity — no pasar por formatDate, que espera un Date/ISO).
      doc.text(`Fecha Vencimiento: ${metadata.invoice.ncfExpiryDate}`, boxX + 8, doc.y + 1, { width: boxWidth - 16 });
    }

    // Comprobantes Modificativos (E33 / E34): la DGII exige que la Representación Impresa
    // referencie de forma destacada el NCF afectado y el motivo (ver muestras
    // oficiales RI_*_E33* y RI_*_E34*.pdf).
    const isNota =
      metadata.invoice.ncfType === 'E33' ||
      metadata.invoice.ncfType === 'E34' ||
      metadata.invoice.ncfType === '33' ||
      metadata.invoice.ncfType === '34';
    let clientBoxY = 130;
    if (isNota && metadata.invoice.ncfModificado) {
      const ncBoxY = headerTop + 74;
      const ncBoxHeight = 34;
      doc.rect(marginX, ncBoxY, contentWidth, ncBoxHeight).stroke();
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text(`NCF Modificado: ${metadata.invoice.ncfModificado}`, marginX + 8, ncBoxY + 6, { width: contentWidth - 16 });
      doc
        .font('Helvetica')
        .fontSize(8)
        .text(
          `Motivo: ${metadata.invoice.razonModificacion || (metadata.invoice.ncfType?.includes('34') ? 'Anula el NCF modificado' : 'Ajuste sobre comprobante previo')}`,
          marginX + 8,
          doc.y + 2,
          { width: contentWidth - 16 },
        );
      clientBoxY = ncBoxY + ncBoxHeight + 8;
    }

    // Datos del receptor / cliente
    doc.rect(marginX, clientBoxY, contentWidth, 42).stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text('DATOS DEL RECEPTOR / CLIENTE', marginX + 8, clientBoxY + 6);
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(`Razón Social / Nombre: ${metadata.client.name}`, marginX + 8, doc.y + 2);
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .text(`${metadata.client.docType || 'Documento'}: ${metadata.client.docNumber}`, marginX + 8, doc.y + 2);

    // Tabla de líneas de detalle
    const tableTop = clientBoxY + 55;
    const cols = [
      { label: 'CANTIDAD', width: 55 },
      { label: 'DESCRIPCIÓN DEL BIEN O SERVICIO', width: 195 },
      { label: 'UNIDAD', width: 45 },
      { label: 'PRECIO UN.', width: 70 },
      { label: 'ITBIS', width: 60 },
      { label: 'VALOR (RD$)', width: contentWidth - 55 - 195 - 45 - 70 - 60 },
    ];
    let colX = marginX;
    doc.rect(marginX, tableTop, contentWidth, 18).fill('#1e293b');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    cols.forEach((col) => {
      doc.text(col.label, colX + 4, tableTop + 5, { width: col.width - 8 });
      colX += col.width;
    });
    doc.fillColor('#000000');

    let rowY = tableTop + 18;
    doc.font('Helvetica').fontSize(8.5);
    metadata.sale.details.forEach((item) => {
      colX = marginX;
      const rowValues = [
        String(item.quantity),
        item.concept,
        item.unidadMedida || 'SERV',
        formatNumber(item.unitPrice),
        formatNumber(item.itbisAmount),
        formatNumber(item.subtotal),
      ];
      rowValues.forEach((val, idx) => {
        doc.text(val, colX + 4, rowY + 5, { width: cols[idx].width - 8 });
        colX += cols[idx].width;
      });
      // Alto dinámico: si la descripción se envuelve a 2+ líneas, la fila crece
      // en vez de dejar que el texto se desborde sobre el borde/fila siguiente.
      const descHeight = doc.heightOfString(item.concept, { width: cols[1].width - 8 });
      rowY += Math.max(20, descHeight + 10);
    });
    doc.rect(marginX, tableTop, contentWidth, rowY - tableTop).stroke();

    // QR + Código de Seguridad (abajo-izquierda) y Totales (abajo-derecha)
    let footerTop = rowY + 30;
    if (footerTop > doc.page.height - 200) {
      doc.addPage();
      footerTop = 40;
    }

    const qrUrl = isProforma
      ? (metadata.invoice.qrCodeUrl || `https://portal.sumtech.com.do/aviso/${encodeURIComponent(metadata.invoice.id)}`)
      : buildDgiiQrUrl(metadata);
    // Se rasteriza a alta resolución (600 px) y luego se dibuja a 90 pt: así el QR
    // sigue siendo legible aunque el PDF se imprima o se fotografe. Ver el
    // comentario de DGII_QR_RENDER_OPTS.
    const qrBuffer = await QRCode.toBuffer(qrUrl, DGII_QR_RENDER_OPTS);
    doc.image(qrBuffer, marginX, footerTop, { width: 90 });
    if (isProforma) {
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .text('ESTADO: PENDIENTE DE PAGO', marginX, footerTop + 95, { width: 220 });
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .text(`Fecha Límite Pago: ${formatDate(metadata.sale.dueDate)}`, marginX, doc.y + 2, { width: 220 });
    } else {
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(`Código de Seguridad: ${metadata.invoice.securityCode || 'N/A'}`, marginX, footerTop + 95, { width: 220 });
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .text(`Fecha Firma Digital: ${formatDateTime(metadata.invoice.issuedAt)}`, marginX, doc.y + 2, { width: 220 });
    }

    // Gravado vs. exento: mismo criterio que buildEcfPayload() (itbisAmount=0 =>
    // exento) para no introducir un segundo criterio de clasificación distinto.
    let subtotalGravado = 0;
    let subtotalExento = 0;
    metadata.sale.details.forEach((item) => {
      if (Number(item.itbisAmount) > 0) {
        subtotalGravado += Number(item.subtotal);
      } else {
        subtotalExento += Number(item.subtotal);
      }
    });

    const totalsBoxX = marginX + 280;
    const totalsBoxWidth = contentWidth - 280;
    doc.font('Helvetica').fontSize(9);
    const totalsLines: Array<[string, string]> = [
      ['Subtotal Gravado:', formatNumber(subtotalGravado)],
      ['Subtotal Exento:', formatNumber(subtotalExento)],
      [subtotalGravado > 0 ? 'Total ITBIS (18%):' : 'Total ITBIS:', formatNumber(metadata.sale.itbisTotal)],
    ];
    let totalsY = footerTop;
    totalsLines.forEach(([label, value]) => {
      doc.text(label, totalsBoxX, totalsY, { width: totalsBoxWidth - 90, continued: false });
      doc.text(value, totalsBoxX + totalsBoxWidth - 90, totalsY, { width: 90, align: 'right' });
      totalsY += 16;
    });
    doc
      .moveTo(totalsBoxX, totalsY + 2)
      .lineTo(totalsBoxX + totalsBoxWidth, totalsY + 2)
      .stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('TOTAL A PAGAR:', totalsBoxX, totalsY + 8, { width: totalsBoxWidth - 100 });
    doc.text(formatCurrency(metadata.sale.grandTotal), totalsBoxX + totalsBoxWidth - 100, totalsY + 8, {
      width: 100,
      align: 'right',
    });

    // Pie legal — posiciones absolutas (no encadenadas a doc.y) para no rozar
    // el margen inferior de la página y disparar la paginación automática de
    // pdfkit a mitad del pie.
    const footerY = doc.page.height - 70;
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text(
        isProforma
          ? 'DOCUMENTO INFORMATIVO NO VÁLIDO PARA CRÉDITO FISCAL - PENDIENTE DE PAGO'
          : 'Esta es una representación impresa de un Comprobante Fiscal Electrónico (e-CF) generado conforme a la norma',
        marginX,
        footerY,
        {
          width: contentWidth,
          align: 'center',
          lineBreak: false,
        },
      );
    doc
      .font('Helvetica')
      .fontSize(7)
      .text(
        `Emitido por ${metadata.company.razonSocial} (RNC ${metadata.company.rnc})${metadata.company.direccion ? ' | ' + metadata.company.direccion : ''}`,
        marginX,
        footerY + 14,
        { width: contentWidth, align: 'center', lineBreak: false },
      );

    return this.streamToBuffer(doc);
  }

  /**
   * Ticket térmico de 80mm con el tamaño de página embebido en el propio PDF
   * (226.77pt = 80mm de ancho), en vez de depender de `@page` CSS + window.print()
   * en el navegador — muchos drivers/diálogos de impresión ignoran el tamaño de
   * página de CSS y usan el papel por defecto del sistema (A4/Carta), que es la
   * causa típica de "se ve bien en pantalla pero imprime en A4". Al generar un
   * PDF real, el tamaño de página queda fijo sin importar el driver.
   */
  /**
   * Genera el recibo térmico de 80mm (rollo de punto de venta). Conforme a la
   * Norma General 06-2018 de la DGII, incluye e-NCF, Código de Seguridad,
   * desglose fiscal y QR escaneable con parámetros oficiales. Al ser un
   * PDF real, el tamaño de página queda fijo sin importar el driver.
   */
  async generateInvoiceThermalPdf(metadata: InvoiceReceiptMetadata): Promise<Buffer> {
    const pageWidth = 226.77; // 80mm exacto en puntos tipográficos
    const marginX = 8;
    const contentWidth = pageWidth - marginX * 2;

    const isNotaThermal =
      metadata.invoice.ncfType === 'E33' ||
      metadata.invoice.ncfType === 'E34' ||
      metadata.invoice.ncfType === '33' ||
      metadata.invoice.ncfType === '34';

    // Estimación dinámica holgada de altura para evitar saltos de página accidentales en el rollo
    let estimatedHeight = 360 + metadata.sale.details.length * 52 + 250;
    if (isNotaThermal) estimatedHeight += 40;
    if (metadata.invoice.ncfExpiryDate && shouldShowNcfExpiry(metadata.invoice.ncfType, metadata.invoice.ncfNumber)) {
      estimatedHeight += 18;
    }
    if (metadata.sale.billingPeriod) estimatedHeight += 18;

    const doc = new (PDFDocument as any)({
      size: [pageWidth, estimatedHeight],
      margin: marginX,
      compress: false,
    }) as PDFKit.PDFDocument;

    // Helper de línea divisoria discontinua con espaciado vertical garantizado (evita solapamiento)
    const drawDashedDivider = (currentY: number): number => {
      const lineY = currentY + 4;
      doc
        .moveTo(marginX, lineY)
        .lineTo(marginX + contentWidth, lineY)
        .dash(1, { space: 1 })
        .stroke()
        .undash();
      return lineY + 6; // Posición Y limpia 6pt debajo de la línea divisoria
    };

    // Helper de línea divisoria sólida con espaciado vertical garantizado (evita solapamiento)
    const drawSolidDivider = (currentY: number): number => {
      const lineY = currentY + 3;
      doc
        .moveTo(marginX, lineY)
        .lineTo(marginX + contentWidth, lineY)
        .stroke();
      return lineY + 6; // Posición Y limpia 6pt debajo de la línea divisoria
    };

    // Helper de 2 columnas seguro: nunca solapa horizontalmente ni verticalmente,
    // calcula la altura máxima real de ambas columnas y actualiza doc.y
    const twoCol = (
      left: string,
      right: string,
      startY: number,
      boldRight = false,
      leftRatio = 0.70,
      fontSize = 7.5,
      boldLeft = false,
    ): number => {
      const rightW = contentWidth * (1 - leftRatio);
      const leftW = contentWidth * leftRatio - 4;
      const rightX = marginX + leftW + 4;

      doc.font(boldLeft ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      doc.text(left, marginX, startY, { width: leftW, lineBreak: true });
      const leftEndY = doc.y;

      if (boldRight) {
        doc.font('Helvetica-Bold');
      } else {
        doc.font('Helvetica');
      }
      doc.fontSize(fontSize);
      doc.text(right, rightX, startY, { width: rightW, align: 'right' });
      const rightEndY = doc.y;
      doc.font('Helvetica');

      const maxY = Math.max(leftEndY, rightEndY);
      doc.y = maxY;
      return maxY;
    };

    // 1. Encabezado de la empresa
    let y = 10;
    doc.font('Helvetica-Bold').fontSize(9.5).text(metadata.company.razonSocial, marginX, y, { width: contentWidth, align: 'center' });
    y = doc.y + 3;

    doc.font('Helvetica-Bold').fontSize(8).text(`RNC: ${metadata.company.rnc}`, marginX, y, { width: contentWidth, align: 'center' });
    y = doc.y + 2;

    doc.font('Helvetica').fontSize(7);
    if (metadata.company.direccion) {
      doc.text(metadata.company.direccion, marginX, y, { width: contentWidth, align: 'center' });
      y = doc.y + 2;
    }

    const contactLine = [metadata.company.telefono ? `Tel: ${metadata.company.telefono}` : null, metadata.company.correo]
      .filter(Boolean)
      .join(' | ');
    if (contactLine) {
      doc.text(contactLine, marginX, y, { width: contentWidth, align: 'center' });
      y = doc.y + 3;
    }

    y = drawDashedDivider(y);

    const isProforma = !!metadata.invoice.isProforma ||
      (metadata.invoice.ncfType || '').toUpperCase().includes('AVISO') ||
      (metadata.invoice.ncfType || '').toUpperCase().includes('PROFORMA') ||
      metadata.sale.paymentMethod === 'PENDIENTE DE PAGO' ||
      (metadata.invoice.ncfNumber || '').startsWith('AVISO-');

    // 2. Identificación del Comprobante Fiscal Electrónico o Aviso de Cobro
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text(
      isProforma ? 'AVISO DE COBRO / PROFORMA' : getNcfTypeLabel(metadata.invoice.ncfType).toUpperCase(),
      marginX,
      y,
      { width: contentWidth, align: 'center' },
    );
    y = doc.y + 3;

    doc.font('Helvetica-Bold').fontSize(8.5);
    doc.text(
      isProforma ? `No. Doc: ${metadata.invoice.ncfNumber || 'AVISO'}` : `e-NCF: ${metadata.invoice.ncfNumber || 'N/A'}`,
      marginX,
      y,
      { width: contentWidth, align: 'center' },
    );
    y = doc.y + 2;

    doc.font('Helvetica').fontSize(7);
    doc.text(
      isProforma ? 'Estado: PENDIENTE DE PAGO' : `Código Seguridad: ${metadata.invoice.securityCode || 'N/A'}`,
      marginX,
      y,
      { width: contentWidth, align: 'center' },
    );
    y = doc.y + 2;

    if (isNotaThermal && metadata.invoice.ncfModificado) {
      y += 2;
      doc.font('Helvetica-Bold').fontSize(7.5);
      doc.text(`NCF Modificado: ${metadata.invoice.ncfModificado}`, marginX, y, { width: contentWidth, align: 'center' });
      y = doc.y + 2;

      const razon =
        metadata.invoice.razonModificacion ||
        (metadata.invoice.ncfType?.includes('34') ? 'Anula el NCF modificado' : 'Ajuste sobre comprobante previo');
      doc.font('Helvetica').fontSize(7);
      doc.text(`Motivo: ${razon}`, marginX, y, { width: contentWidth, align: 'center' });
      y = doc.y + 2;
    }

    y = drawDashedDivider(y);

    // 3. Datos del cliente y emisión
    doc.font('Helvetica').fontSize(7.5);
    doc.text(`Fecha Emisión: ${formatDateTime(metadata.invoice.issuedAt)}`, marginX, y, { width: contentWidth });
    y = doc.y + 2.5;

    if (metadata.invoice.ncfExpiryDate && shouldShowNcfExpiry(metadata.invoice.ncfType, metadata.invoice.ncfNumber)) {
      doc.text(`Fecha Vencimiento Secuencia: ${metadata.invoice.ncfExpiryDate}`, marginX, y, { width: contentWidth });
      y = doc.y + 2.5;
    }

    doc.text(`Cliente: ${metadata.client.name}`, marginX, y, { width: contentWidth });
    y = doc.y + 2.5;
    doc.text(`${metadata.client.docType || 'Documento'}: ${metadata.client.docNumber}`, marginX, y, { width: contentWidth });
    y = doc.y + 2.5;

    if (metadata.sale.billingPeriod) {
      doc.text(`Período Facturado: ${metadata.sale.billingPeriod}`, marginX, y, { width: contentWidth });
      y = doc.y + 2.5;
    }
    doc.text(`Cajero: ${metadata.sale.cashier}`, marginX, y, { width: contentWidth });
    y = doc.y + 3;

    y = drawDashedDivider(y);

    // 4. Líneas de detalle de la factura
    y = twoCol('CANT. / DESCRIPCIÓN', 'TOTAL (RD$)', y, true, 0.70, 7, true) + 5;

    metadata.sale.details.forEach((item) => {
      const itemDesc = `${item.quantity}x ${item.concept}`;
      const itemTotalStr = formatNumber(item.subtotal);
      const itemBottomY = twoCol(itemDesc, itemTotalStr, y, true, 0.72, 7.5, false);

      y = itemBottomY + 2.5;
      doc.font('Helvetica').fontSize(6.5);
      const unitInfo = `Precio: ${formatNumber(item.unitPrice)}   ITBIS: ${formatNumber(item.itbisAmount)}${item.unidadMedida ? `   (${item.unidadMedida})` : ''}`;
      doc.text(unitInfo, marginX + 4, y, { width: contentWidth - 4 });
      y = doc.y + 5;
    });

    y = drawDashedDivider(y);

    // 5. Totales fiscales (Desglose dinámico según montos gravados y exentos)
    let subtotalGravado = 0;
    let subtotalExento = 0;
    metadata.sale.details.forEach((item) => {
      if (Number(item.itbisAmount) > 0) {
        subtotalGravado += Number(item.subtotal);
      } else {
        subtotalExento += Number(item.subtotal);
      }
    });

    if (subtotalGravado > 0 && subtotalExento > 0) {
      y = twoCol('Subtotal Gravado:', formatNumber(subtotalGravado), y, false, 0.65, 7.5) + 3;
      y = twoCol('Subtotal Exento:', formatNumber(subtotalExento), y, false, 0.65, 7.5) + 3;
      y = twoCol('ITBIS Facturado (18%):', formatNumber(metadata.sale.itbisTotal), y, false, 0.65, 7.5) + 3;
    } else if (subtotalExento > 0 && subtotalGravado === 0) {
      y = twoCol('Subtotal Exento:', formatNumber(subtotalExento), y, false, 0.65, 7.5) + 3;
      y = twoCol('Total ITBIS:', formatNumber(metadata.sale.itbisTotal), y, false, 0.65, 7.5) + 3;
    } else {
      y = twoCol('Subtotal Gravado:', formatNumber(subtotalGravado || metadata.sale.subtotal), y, false, 0.65, 7.5) + 3;
      y = twoCol('ITBIS Facturado (18%):', formatNumber(metadata.sale.itbisTotal), y, false, 0.65, 7.5) + 3;
    }

    y = drawSolidDivider(y);

    y = twoCol('TOTAL A PAGAR:', formatCurrency(metadata.sale.grandTotal), y, true, 0.55, 8.5, true) + 10;

    // 6. Código QR oficial DGII
    const qrUrl = buildDgiiQrUrl(metadata);
    const qrSize = 85;
    // qrSize sigue siendo el tamaño FÍSICO del QR en el ticket; la resolución del
    // PNG es independiente (600 px, no 170 px) para que no se vuelva ilegible al
    // imprimir. Ver el comentario de DGII_QR_RENDER_OPTS.
    const qrBuffer = await QRCode.toBuffer(qrUrl, DGII_QR_RENDER_OPTS);
    doc.image(qrBuffer, marginX + (contentWidth - qrSize) / 2, y, { width: qrSize });
    y += qrSize + 6;

    doc.font('Helvetica').fontSize(6);
    doc.text('Consulte la validez de este comprobante en el portal oficial de la DGII', marginX, y, {
      width: contentWidth,
      align: 'center',
    });
    y = doc.y + 5;

    // 7. Leyenda legal obligatoria DGII o de Aviso de Cobro
    doc.font('Helvetica-Bold').fontSize(6.5);
    doc.text(
      isProforma
        ? '*** DOCUMENTO INFORMATIVO NO VÁLIDO PARA CRÉDITO FISCAL ***'
        : 'Esta es una representación impresa de un Comprobante Fiscal Electrónico (e-CF)',
      marginX,
      y,
      {
        width: contentWidth,
        align: 'center',
      },
    );
    y = doc.y + 1.5;

    doc.font('Helvetica').fontSize(6);
    doc.text(
      isProforma ? 'Pendiente de cobro — regularice su pago en las vías autorizadas' : 'generado conforme a la normativa de la DGII',
      marginX,
      y,
      {
        width: contentWidth,
        align: 'center',
      },
    );
    y = doc.y + 6;

    // 8. Pie de página comercial
    doc.font('Helvetica-Bold').fontSize(7.5);
    doc.text('¡Gracias por su preferencia!', marginX, y, {
      width: contentWidth,
      align: 'center',
    });
    y = doc.y + 2;

    doc.font('Helvetica').fontSize(6.5);
    doc.text('Servicio de Telecomunicaciones de Alta Velocidad', marginX, y, {
      width: contentWidth,
      align: 'center',
    });

    return this.streamToBuffer(doc);
  }

  async generateContractPdf(data: ContractPdfData): Promise<Buffer> {
    const doc = new (PDFDocument as any)({ size: 'A4', margin: 40, compress: false }) as PDFKit.PDFDocument;
    const marginX = 40;
    const contentWidth = doc.page.width - marginX * 2;

    this.drawCompanyHeader(doc, data.company, marginX, 40, contentWidth);

    doc.moveDown(1.5);
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .text('CONTRATO DE SERVICIOS DE TELECOMUNICACIONES', marginX, doc.y + 10, { width: contentWidth, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(`No. ${data.contract.contractNumber}`, marginX, doc.y + 4, { width: contentWidth, align: 'center' });

    const clientBoxY = doc.y + 20;
    doc.rect(marginX, clientBoxY, contentWidth, 55).stroke();
    doc.font('Helvetica-Bold').fontSize(9).text('DATOS DEL CLIENTE', marginX + 8, clientBoxY + 6);
    doc.font('Helvetica').fontSize(8.5).text(`Nombre: ${data.client.name}`, marginX + 8, doc.y + 3);
    doc.text(`${data.client.docType}: ${data.client.docNumber}`, marginX + 8, doc.y + 2);
    if (data.client.phone || data.client.email) {
      doc.text([data.client.phone, data.client.email].filter(Boolean).join('  |  '), marginX + 8, doc.y + 2);
    }

    let nextBoxY = clientBoxY + 65;
    if (data.portalCredentials) {
      const credentialsBoxHeight = 40;
      doc.rect(marginX, nextBoxY, contentWidth, credentialsBoxHeight).stroke();
      doc.font('Helvetica-Bold').fontSize(9).text('ACCESO AL PORTAL DE AUTOSERVICIO', marginX + 8, nextBoxY + 6);
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .text(`Usuario: ${data.portalCredentials.username}    Contraseña: ${data.portalCredentials.password}`, marginX + 8, doc.y + 3);
      doc
        .font('Helvetica-Oblique')
        .fontSize(7.5)
        .text('Ingrese en el portal del cliente y cambie esta contraseña en su primer inicio de sesión.', marginX + 8, doc.y + 2, {
          width: contentWidth - 16,
        });
      nextBoxY += credentialsBoxHeight + 10;
    }

    const serviceBoxY = nextBoxY;
    doc.rect(marginX, serviceBoxY, contentWidth, 78).stroke();
    doc.font('Helvetica-Bold').fontSize(9).text('DATOS DEL SERVICIO', marginX + 8, serviceBoxY + 6);
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .text(
        `Plan: ${data.plan.name} (${data.plan.serviceType})${data.plan.speedMbps ? ` — ${data.plan.speedMbps} Mbps` : ''}`,
        marginX + 8,
        doc.y + 3,
      );
    doc.text(`Precio mensual: ${formatCurrency(data.plan.monthlyPrice)}`, marginX + 8, doc.y + 2);
    doc.text(`Día de facturación: ${data.contract.billingDay}`, marginX + 8, doc.y + 2);
    doc.text(
      `Dirección de instalación: ${[data.address.street, data.address.buildingNumber, data.address.sector, data.address.municipality, data.address.city]
        .filter(Boolean)
        .join(', ')}`,
      marginX + 8,
      doc.y + 2,
      { width: contentWidth - 16 },
    );
    doc.text(
      `Fecha inicio: ${formatDate(data.contract.startDate)}    Estado: ${CONTRACT_STATUS_LABELS[data.contract.status] || data.contract.status}`,
      marginX + 8,
      doc.y + 2,
    );

    doc.font('Helvetica-Bold').fontSize(9).text('CLÁUSULAS GENERALES', marginX, serviceBoxY + 95);
    doc.font('Helvetica').fontSize(8);
    const clausesToPrint =
      data.company.contractClauses && data.company.contractClauses.length > 0
        ? data.company.contractClauses
        : CONTRACT_CLAUSES_PLACEHOLDER;
    clausesToPrint.forEach((clause) => {
      doc.text(clause, marginX, doc.y + 6, { width: contentWidth, align: 'justify' });
    });

    const signatureY = Math.max(doc.y + 50, doc.page.height - 130);
    const clientSignatureX = marginX;
    const companySignatureX = marginX + contentWidth - 200;

    doc
      .moveTo(clientSignatureX, signatureY)
      .lineTo(clientSignatureX + 200, signatureY)
      .stroke();
    doc
      .moveTo(companySignatureX, signatureY)
      .lineTo(marginX + contentWidth, signatureY)
      .stroke();

    this.drawSignatureIfPresent(doc, data.signatures?.client, clientSignatureX, signatureY);
    this.drawSignatureIfPresent(doc, data.signatures?.company, companySignatureX, signatureY);

    doc.font('Helvetica').fontSize(8).text('Firma del Cliente', clientSignatureX, signatureY + 5, { width: 200, align: 'center' });
    doc.text('Firma de la Empresa', companySignatureX, signatureY + 5, { width: 200, align: 'center' });

    return this.streamToBuffer(doc);
  }

  /**
   * Dibuja la imagen de la firma (PNG) justo encima de su línea, con una
   * leyenda de quién y cuándo firmó — o no dibuja nada si esa parte todavía
   * no firmó (la línea en blanco de siempre, sin regresión de comportamiento).
   */
  private drawSignatureIfPresent(
    doc: PDFKit.PDFDocument,
    signature: { imageBuffer: Buffer; signedByName: string; signedAt: Date } | undefined,
    lineX: number,
    lineY: number,
  ): void {
    if (!signature) return;

    const imageHeight = 45;
    const imageWidth = 190;
    doc.image(signature.imageBuffer, lineX + 5, lineY - imageHeight - 2, {
      fit: [imageWidth, imageHeight],
      align: 'center',
    });
    doc
      .font('Helvetica-Oblique')
      .fontSize(6.5)
      .text(`Firmado electrónicamente el ${formatDateTime(signature.signedAt)} por ${signature.signedByName}`, lineX, lineY + 16, {
        width: 200,
        align: 'center',
      });
  }

  /**
   * Listado tabular de clientes en A4 horizontal, para el export desde
   * /dashboard/clientes (solo ADMIN/GERENTE). Solo muestra un subconjunto de
   * 8 columnas legibles en una hoja impresa — el detalle completo de 19
   * columnas vive en los formatos Excel/CSV, pensados para procesamiento.
   * `bufferPages: true` permite numerar "Página X de Y" al final, una vez que
   * se sabe cuántas páginas generó el contenido.
   */
  async generateClientsListPdf(data: ClientsListPdfData): Promise<Buffer> {
    const doc = new (PDFDocument as any)({
      size: 'A4',
      layout: 'landscape',
      margin: 30,
      compress: false,
      bufferPages: true,
    }) as PDFKit.PDFDocument;
    const marginX = 30;
    const contentWidth = doc.page.width - marginX * 2;
    const bottomLimit = doc.page.height - 45;

    const columns: Array<{ key: keyof ClientsListPdfData['rows'][number]; label: string; width: number }> = [
      { key: 'nombre', label: 'Cliente', width: 148 },
      { key: 'documento', label: 'Documento', width: 108 },
      { key: 'telefono', label: 'Teléfono', width: 72 },
      { key: 'ubicacion', label: 'Ubicación', width: 128 },
      { key: 'planActivo', label: 'Plan Activo', width: 98 },
      { key: 'estadoContrato', label: 'Estado Contrato', width: 82 },
      { key: 'estadoCliente', label: 'Estado Cliente', width: 68 },
      { key: 'fechaAlta', label: 'Fecha Alta', width: 66 },
    ];

    const drawPageHeader = (): number => {
      const top = 30;
      this.drawCompanyHeader(doc, data.company, marginX, top, 320);

      const rightX = marginX + 330;
      const rightWidth = contentWidth - 330;
      doc.font('Helvetica-Bold').fontSize(13).text('LISTADO DE CLIENTES', rightX, top, { width: rightWidth, align: 'right' });
      doc
        .font('Helvetica')
        .fontSize(8)
        .text(`Generado: ${formatDateTime(data.generatedAt)}`, rightX, top + 20, { width: rightWidth, align: 'right' });
      doc.text(`Por: ${data.generatedByUsername}`, rightX, top + 32, { width: rightWidth, align: 'right' });
      doc.text(`Total exportado: ${data.totalExportado}`, rightX, top + 44, { width: rightWidth, align: 'right' });
      doc
        .font('Helvetica-Oblique')
        .fontSize(7.5)
        .text(`Filtros: ${data.filtersSummary}`, rightX, top + 58, { width: rightWidth, align: 'right' });

      return this.drawTableHeaderRow(doc, columns, marginX, top + 90, contentWidth);
    };

    let rowY = drawPageHeader();
    doc.font('Helvetica').fontSize(7.5).fillColor('#000000');

    data.rows.forEach((row) => {
      const nombreHeight = doc.heightOfString(row.nombre || '', { width: columns[0].width - 8 });
      const rowHeight = Math.max(14, nombreHeight + 6);

      if (rowY + rowHeight > bottomLimit) {
        doc.addPage();
        rowY = drawPageHeader();
        doc.font('Helvetica').fontSize(7.5).fillColor('#000000');
      }

      let colX = marginX;
      columns.forEach((col) => {
        doc.text(String(row[col.key] ?? ''), colX + 4, rowY + 4, { width: col.width - 8 });
        colX += col.width;
      });
      doc
        .moveTo(marginX, rowY + rowHeight)
        .lineTo(marginX + contentWidth, rowY + rowHeight)
        .strokeColor('#e2e8f0')
        .stroke();
      rowY += rowHeight;
    });

    if (data.rows.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(9).text('No se encontraron clientes con los filtros aplicados.', marginX, rowY + 10);
    }

    const pageRange = doc.bufferedPageRange();
    for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
      doc.switchToPage(i);
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#64748b')
        .text(`Página ${i + 1} de ${pageRange.count}`, marginX, doc.page.height - 30, {
          width: contentWidth,
          align: 'center',
        });
    }

    return this.streamToBuffer(doc);
  }

  private drawTableHeaderRow(
    doc: PDFKit.PDFDocument,
    columns: Array<{ label: string; width: number }>,
    marginX: number,
    y: number,
    contentWidth: number,
  ): number {
    doc.rect(marginX, y, contentWidth, 18).fill('#1e293b');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    let colX = marginX;
    columns.forEach((col) => {
      doc.text(col.label, colX + 4, y + 5, { width: col.width - 8 });
      colX += col.width;
    });
    doc.fillColor('#000000');
    return y + 18;
  }
}
