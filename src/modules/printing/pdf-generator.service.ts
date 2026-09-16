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
  E44: 'COMPROBANTE REGÍMENES ESPECIALES ELECTRÓNICO',
  E45: 'COMPROBANTE GUBERNAMENTAL ELECTRÓNICO',
  B01: 'FACTURA DE CRÉDITO FISCAL',
  B02: 'FACTURA DE CONSUMO FINAL',
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
    doc.font('Helvetica-Bold').fontSize(14).text(company.razonSocial, x, y, { width });
    if (company.nombreComercial && company.nombreComercial !== company.razonSocial) {
      doc.font('Helvetica-Bold').fontSize(11).text(company.nombreComercial, x, doc.y, { width });
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

    const boxX = marginX + 310;
    const boxWidth = contentWidth - 310;
    doc.rect(boxX, headerTop, boxWidth, 70).stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(NCF_TYPE_LABELS[metadata.invoice.ncfType || ''] || 'COMPROBANTE FISCAL ELECTRÓNICO (e-CF)', boxX + 8, headerTop + 8, {
        width: boxWidth - 16,
      });
    doc.font('Helvetica-Bold').fontSize(11).text(`e-NCF: ${metadata.invoice.ncfNumber || 'N/A'}`, boxX + 8, doc.y + 4, {
      width: boxWidth - 16,
    });
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .text(`Fecha Emisión: ${formatDate(metadata.invoice.issuedAt)}`, boxX + 8, doc.y + 4, { width: boxWidth - 16 });
    if (metadata.invoice.ncfExpiryDate) {
      // Vencimiento de la secuencia de NCF (ya viene en formato dd-MM-yyyy desde
      // EcfSequenceEntity — no pasar por formatDate, que espera un Date/ISO).
      doc.text(`Fecha Vencimiento: ${metadata.invoice.ncfExpiryDate}`, boxX + 8, doc.y + 1, { width: boxWidth - 16 });
    }

    // Nota de Crédito (E34): la DGII exige que la Representación Impresa
    // referencie de forma destacada el NCF anulado y el motivo (ver muestras
    // oficiales RI_*_E34*.pdf).
    let clientBoxY = 130;
    if (metadata.invoice.ncfType === 'E34' && metadata.invoice.ncfModificado) {
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
        .text(`Motivo: ${metadata.invoice.razonModificacion || 'Anula el NCF modificado'}`, marginX + 8, doc.y + 2, {
          width: contentWidth - 16,
        });
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

    const qrUrl = metadata.invoice.qrCodeUrl || `https://ecf.dgii.gov.do/testecf/consultatimbre?encf=${metadata.invoice.ncfNumber}`;
    const qrBuffer = await QRCode.toBuffer(qrUrl, { type: 'png', width: 110, margin: 1 });
    doc.image(qrBuffer, marginX, footerTop, { width: 90 });
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(`Código de Seguridad: ${metadata.invoice.securityCode || 'N/A'}`, marginX, footerTop + 95, { width: 220 });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .text(`Fecha Firma Digital: ${formatDate(metadata.invoice.issuedAt)}`, marginX, doc.y + 2, { width: 220 });

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
      .text('Esta es una representación impresa de un Comprobante Fiscal Electrónico (e-CF) generado conforme a la norma', marginX, footerY, {
        width: contentWidth,
        align: 'center',
        lineBreak: false,
      });
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
  async generateInvoiceThermalPdf(metadata: InvoiceReceiptMetadata): Promise<Buffer> {
    const pageWidth = 226.77; // 80mm
    const marginX = 8;
    const contentWidth = pageWidth - marginX * 2;

    // Alto estimado según la cantidad de líneas — pdfkit no soporta "auto"
    // como el CSS @page; se calcula antes de crear el documento (patrón común
    // para recibos térmicos), dejando algo de holgura al final.
    const estimatedHeight = 260 + metadata.sale.details.length * 34 + 220;

    const doc = new (PDFDocument as any)({
      size: [pageWidth, estimatedHeight],
      margin: marginX,
      compress: false,
    }) as PDFKit.PDFDocument;

    const center = (text: string, y: number, opts: PDFKit.Mixins.TextOptions = {}) =>
      doc.text(text, marginX, y, { width: contentWidth, align: 'center', ...opts });

    const twoCol = (left: string, right: string, y: number, boldRight = false) => {
      doc.font('Helvetica').text(left, marginX, y, { width: contentWidth * 0.6, continued: false });
      if (boldRight) doc.font('Helvetica-Bold');
      doc.text(right, marginX, y, { width: contentWidth, align: 'right' });
      doc.font('Helvetica');
    };

    // Encabezado de la empresa
    doc.font('Helvetica-Bold').fontSize(10).text(metadata.company.razonSocial, marginX, 8, { width: contentWidth, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(8).text(`RNC: ${metadata.company.rnc}`, marginX, doc.y + 1, { width: contentWidth, align: 'center' });
    doc.font('Helvetica').fontSize(7);
    if (metadata.company.direccion) center(metadata.company.direccion, doc.y + 1);
    const contactLine = [metadata.company.telefono ? `Tel: ${metadata.company.telefono}` : null, metadata.company.correo]
      .filter(Boolean)
      .join(' | ');
    if (contactLine) center(contactLine, doc.y + 1);

    doc
      .moveTo(marginX, doc.y + 4)
      .lineTo(marginX + contentWidth, doc.y + 4)
      .dash(1, { space: 1 })
      .stroke()
      .undash();

    doc.font('Helvetica-Bold').fontSize(7.5);
    center((NCF_TYPE_LABELS[metadata.invoice.ncfType || ''] || 'COMPROBANTE FISCAL ELECTRÓNICO (e-CF)').toUpperCase(), doc.y + 8);
    doc.font('Helvetica-Bold').fontSize(8);
    center(`e-NCF: ${metadata.invoice.ncfNumber || 'N/A'}`, doc.y + 3);
    doc.font('Helvetica').fontSize(7);
    center(`Código Seguridad: ${metadata.invoice.securityCode || 'N/A'}`, doc.y + 2);
    if (metadata.invoice.ncfType === 'E34' && metadata.invoice.ncfModificado) {
      center(`NCF Modificado: ${metadata.invoice.ncfModificado}`, doc.y + 3);
      center(`Motivo: ${metadata.invoice.razonModificacion || 'Anula el NCF modificado'}`, doc.y + 1);
    }

    doc
      .moveTo(marginX, doc.y + 5)
      .lineTo(marginX + contentWidth, doc.y + 5)
      .dash(1, { space: 1 })
      .stroke()
      .undash();

    // Datos del cliente y período
    doc.font('Helvetica').fontSize(7.5);
    let y = doc.y + 8;
    doc.text(`Fecha Emisión: ${formatDate(metadata.invoice.issuedAt)}`, marginX, y, { width: contentWidth });
    y = doc.y + 2;
    doc.text(`Cliente: ${metadata.client.name}`, marginX, y, { width: contentWidth });
    y = doc.y + 2;
    doc.text(`${metadata.client.docType || 'Documento'}: ${metadata.client.docNumber}`, marginX, y, { width: contentWidth });
    y = doc.y + 2;
    if (metadata.sale.billingPeriod) {
      doc.text(`Período Facturado: ${metadata.sale.billingPeriod}`, marginX, y, { width: contentWidth });
      y = doc.y + 2;
    }
    doc.text(`Cajero: ${metadata.sale.cashier}`, marginX, y, { width: contentWidth });

    doc
      .moveTo(marginX, doc.y + 5)
      .lineTo(marginX + contentWidth, doc.y + 5)
      .dash(1, { space: 1 })
      .stroke()
      .undash();

    // Líneas de detalle
    y = doc.y + 8;
    doc.font('Helvetica-Bold').fontSize(7);
    twoCol('CANT. / DESCRIPCIÓN', 'TOTAL (RD$)', y, true);
    y = doc.y + 10;
    doc.font('Helvetica').fontSize(7.5);
    metadata.sale.details.forEach((item) => {
      twoCol(`${item.quantity}x ${item.concept}`, formatNumber(item.subtotal), y, true);
      y = doc.y + 1;
      doc
        .font('Helvetica')
        .fontSize(6.5)
        .text(`Precio: ${formatNumber(item.unitPrice)}   ITBIS: ${formatNumber(item.itbisAmount)}`, marginX, y, {
          width: contentWidth,
        });
      y = doc.y + 6;
      doc.fontSize(7.5);
    });

    doc
      .moveTo(marginX, y)
      .lineTo(marginX + contentWidth, y)
      .dash(1, { space: 1 })
      .stroke()
      .undash();

    // Totales
    y += 8;
    doc.font('Helvetica').fontSize(8);
    twoCol('Subtotal:', formatNumber(metadata.sale.subtotal), y);
    y = doc.y + 3;
    twoCol('ITBIS Facturado (18%):', formatNumber(metadata.sale.itbisTotal), y);
    y = doc.y + 4;
    doc
      .moveTo(marginX, y)
      .lineTo(marginX + contentWidth, y)
      .stroke();
    y += 4;
    doc.font('Helvetica-Bold').fontSize(9.5);
    twoCol('TOTAL A PAGAR:', formatCurrency(metadata.sale.grandTotal), y);

    // QR oficial DGII
    y = doc.y + 12;
    const qrUrl = metadata.invoice.qrCodeUrl || `https://ecf.dgii.gov.do/testecf/consultatimbre?encf=${metadata.invoice.ncfNumber}`;
    const qrSize = 90;
    const qrBuffer = await QRCode.toBuffer(qrUrl, { type: 'png', width: qrSize * 2, margin: 1 });
    doc.image(qrBuffer, marginX + (contentWidth - qrSize) / 2, y, { width: qrSize });
    y += qrSize + 6;
    doc.font('Helvetica').fontSize(6);
    center('Consulte la validez de este comprobante en el portal oficial de la DGII', y);

    // Pie de página
    y = doc.y + 8;
    doc.font('Helvetica-Bold').fontSize(7.5);
    center('¡Gracias por su preferencia!', y);
    doc.font('Helvetica').fontSize(7);
    center('Servicio de Telecomunicaciones de Alta Velocidad', doc.y + 1);

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
    CONTRACT_CLAUSES_PLACEHOLDER.forEach((clause) => {
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
