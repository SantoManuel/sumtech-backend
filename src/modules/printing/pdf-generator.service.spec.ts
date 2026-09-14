import { Test, TestingModule } from '@nestjs/testing';
import { PdfGeneratorService } from './pdf-generator.service';
import { InvoiceReceiptMetadata, ContractPdfData } from './pdf-generator.types';

/**
 * pdfkit escribe el texto de los content streams como cadenas hexadecimales
 * dentro de operadores `Tj`/`TJ` (codificación WinAnsi, que para el rango ASCII
 * coincide byte a byte con el código de carácter). Para poder verificar el
 * contenido real de un PDF sin depender de un parser completo, se decodifican
 * esas cadenas hex de vuelta a texto plano.
 */
function decodeHex(hex: string): string {
  const cleaned = hex.replace(/\s+/g, '');
  let text = '';
  for (let i = 0; i + 1 < cleaned.length; i += 2) {
    text += String.fromCharCode(parseInt(cleaned.substr(i, 2), 16));
  }
  return text;
}

function countPdfPages(buffer: Buffer): number {
  const raw = buffer.toString('latin1');
  const match = raw.match(/\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  // Cada operador Tj/TJ es un "run" de texto (p. ej. una línea o llamada a
  // .text()); dentro de un mismo run los tokens hex van pegados (los splits
  // internos son solo ajustes de kerning, no separadores de palabra), pero
  // entre runs distintos sí se preserva un espacio para no fusionar palabras
  // de llamadas .text() separadas.
  const runs: string[] = [];

  const tjRegex = /<([0-9a-fA-F\s]+)>\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = tjRegex.exec(raw))) {
    runs.push(decodeHex(match[1]));
  }

  const tjArrayRegex = /\[((?:\s*(?:<[0-9a-fA-F\s]+>|-?[\d.]+))+)\s*\]\s*TJ/g;
  while ((match = tjArrayRegex.exec(raw))) {
    const innerHexTokens = match[1].match(/<[0-9a-fA-F\s]+>/g) || [];
    runs.push(innerHexTokens.map((h) => decodeHex(h.slice(1, -1))).join(''));
  }

  return runs.join(' ');
}

describe('PdfGeneratorService', () => {
  let service: PdfGeneratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PdfGeneratorService],
    }).compile();

    service = module.get<PdfGeneratorService>(PdfGeneratorService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('generateInvoiceA4Pdf', () => {
    const metadata: InvoiceReceiptMetadata = {
      company: {
        rnc: '131000000',
        razonSocial: 'SUMTECH TELECOM S.R.L.',
        nombreComercial: 'SUMTECH FIBRA & TV',
        direccion: 'Av. 27 de Febrero, Santo Domingo',
        telefono: '809-555-0199',
        correo: 'facturacion@sumtech.com.do',
      },
      invoice: {
        id: 'inv-1',
        ncfNumber: 'E3200000042',
        ncfType: 'E32',
        dgiiStatus: 'ACCEPTED',
        securityCode: 'ZxQ7mK',
        qrCodeUrl: 'https://ecf.dgii.gov.do/testecf/consultatimbre?encf=E3200000042',
        issuedAt: new Date('2026-08-14T18:55:31Z'),
        contingencyMode: false,
      },
      client: {
        name: 'Juan Perez Distribuciones',
        docNumber: '131880681',
        docType: 'RNC',
        email: 'juan@cliente.com',
      },
      sale: {
        id: 'sale-1',
        paymentMethod: 'CASH',
        billingPeriod: 'Agosto 2026',
        dueDate: '2026-08-31',
        subtotal: 1500,
        discountAmount: 0,
        itbisTotal: 270,
        grandTotal: 1770,
        cashier: 'Caja Principal',
        details: [
          { concept: 'Plan Fibra 100 Mbps', quantity: 1, unitPrice: 1500, itbisAmount: 270, subtotal: 1500, unidadMedida: 'SERV' },
        ],
      },
    };

    it('genera un Buffer con la firma %PDF- válida', async () => {
      const buffer = await service.generateInvoiceA4Pdf(metadata);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it('incluye el e-NCF, el nombre del cliente y el código de seguridad en el contenido', async () => {
      const buffer = await service.generateInvoiceA4Pdf(metadata);
      const text = extractPdfText(buffer);

      expect(text).toContain('E3200000042');
      expect(text).toContain('Juan');
      expect(text).toContain('ZxQ7mK');
    });

    it('incluye el detalle de la línea de factura y el total a pagar', async () => {
      const buffer = await service.generateInvoiceA4Pdf(metadata);
      const text = extractPdfText(buffer);

      expect(text).toContain('Plan Fibra');
      expect(text).toContain('TOTAL A PAGAR');
    });

    it('una factura de un solo ítem cabe en una única página (no se desborda el pie legal)', async () => {
      const buffer = await service.generateInvoiceA4Pdf(metadata);
      expect(countPdfPages(buffer)).toBe(1);
    });

    it('agrega una página adicional cuando el detalle no cabe en una sola página', async () => {
      const manyItems: InvoiceReceiptMetadata = {
        ...metadata,
        sale: {
          ...metadata.sale,
          details: Array.from({ length: 40 }, (_, i) => ({
            concept: `Item de prueba numero ${i + 1}`,
            quantity: 1,
            unitPrice: 100,
            itbisAmount: 18,
            subtotal: 100,
            unidadMedida: 'SERV',
          })),
        },
      };

      const buffer = await service.generateInvoiceA4Pdf(manyItems);
      expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(extractPdfText(buffer)).toContain('TOTAL A PAGAR');
    });

    it('muestra la columna UNIDAD con la etiqueta de cada ítem (SERV/UND)', async () => {
      const mixed: InvoiceReceiptMetadata = {
        ...metadata,
        sale: {
          ...metadata.sale,
          details: [
            { concept: 'Instalación Fibra', quantity: 1, unitPrice: 1000, itbisAmount: 180, subtotal: 1000, unidadMedida: 'SERV' },
            { concept: 'Router GPON', quantity: 1, unitPrice: 500, itbisAmount: 90, subtotal: 500, unidadMedida: 'UND' },
          ],
        },
      };

      const text = extractPdfText(await service.generateInvoiceA4Pdf(mixed));
      expect(text).toContain('UNIDAD');
      expect(text).toContain('SERV');
      expect(text).toContain('UND');
    });

    it('separa Subtotal Gravado y Subtotal Exento según el ITBIS de cada línea', async () => {
      const withExempt: InvoiceReceiptMetadata = {
        ...metadata,
        sale: {
          ...metadata.sale,
          subtotal: 1600,
          itbisTotal: 270,
          grandTotal: 1870,
          details: [
            { concept: 'Plan Fibra 100 Mbps', quantity: 1, unitPrice: 1500, itbisAmount: 270, subtotal: 1500, unidadMedida: 'SERV' },
            { concept: 'Cargo exento', quantity: 1, unitPrice: 100, itbisAmount: 0, subtotal: 100, unidadMedida: 'SERV' },
          ],
        },
      };

      const text = extractPdfText(await service.generateInvoiceA4Pdf(withExempt));
      expect(text).toContain('Subtotal Gravado');
      expect(text).toContain('Subtotal Exento');
      expect(text).toContain('1,500.00');
      expect(text).toContain('100.00');
      expect(text).toContain('Total ITBIS (18%)');
    });

    it('etiqueta "Total ITBIS:" sin porcentaje cuando la factura es totalmente exenta', async () => {
      const allExempt: InvoiceReceiptMetadata = {
        ...metadata,
        sale: {
          ...metadata.sale,
          subtotal: 1,
          itbisTotal: 0,
          grandTotal: 1,
          details: [{ concept: 'Servicio exento', quantity: 1, unitPrice: 1, itbisAmount: 0, subtotal: 1, unidadMedida: 'SERV' }],
        },
      };

      const text = extractPdfText(await service.generateInvoiceA4Pdf(allExempt));
      expect(text).toContain('Total ITBIS:');
      expect(text).not.toContain('Total ITBIS (18%)');
    });

    it('no antepone "RD$" a los montos de línea ni del recuadro de totales — solo a TOTAL A PAGAR', async () => {
      const text = extractPdfText(await service.generateInvoiceA4Pdf(metadata));
      expect(text).not.toContain('RD$ 1,500.00');
      expect(text).toContain('RD$ 1,770.00');
    });

    it('no muestra "Fecha Vencimiento" para E32 (sin ncfExpiryDate)', async () => {
      const text = extractPdfText(await service.generateInvoiceA4Pdf(metadata));
      expect(text).not.toContain('Fecha Vencimiento');
    });

    it('muestra "Fecha Vencimiento" con el vencimiento real de la secuencia de NCF (no la fecha de cobro)', async () => {
      const e31WithExpiry: InvoiceReceiptMetadata = {
        ...metadata,
        invoice: { ...metadata.invoice, ncfType: 'E31', ncfNumber: 'E3100000010', ncfExpiryDate: '31-12-2028' },
      };

      const text = extractPdfText(await service.generateInvoiceA4Pdf(e31WithExpiry));
      expect(text).toContain('Fecha Vencimiento');
      expect(text).toContain('31-12-2028');
    });

    it('para una Nota de Crédito (E34) muestra el NCF Modificado y el Motivo de forma destacada', async () => {
      const creditNoteMetadata: InvoiceReceiptMetadata = {
        ...metadata,
        invoice: {
          ...metadata.invoice,
          ncfType: 'E34',
          ncfNumber: 'E340000000001',
          ncfModificado: 'E3100000001701',
          razonModificacion: 'Factura generada por error de plan',
        },
      };

      const text = extractPdfText(await service.generateInvoiceA4Pdf(creditNoteMetadata));
      expect(text).toContain('NOTA DE CRÉDITO ELECTRÓNICA');
      expect(text).toContain('NCF Modificado:');
      expect(text).toContain('E3100000001701');
      expect(text).toContain('Motivo:');
      expect(text).toContain('Factura generada por error de plan');
    });

    it('no muestra el bloque de Nota de Crédito para una factura normal (E32)', async () => {
      const text = extractPdfText(await service.generateInvoiceA4Pdf(metadata));
      expect(text).not.toContain('NCF Modificado:');
    });
  });

  describe('generateContractPdf', () => {
    const contractData: ContractPdfData = {
      company: {
        rnc: '131000000',
        razonSocial: 'SUMTECH TELECOM S.R.L.',
        nombreComercial: 'SUMTECH FIBRA & TV',
        direccion: 'Av. 27 de Febrero, Santo Domingo',
        telefono: '809-555-0199',
        correo: 'facturacion@sumtech.com.do',
      },
      contract: {
        contractNumber: 'CTR-000123',
        status: 'ACTIVE',
        startDate: '2026-03-01',
        billingDay: 15,
      },
      client: {
        name: 'Ana Gomez',
        docType: 'CEDULA',
        docNumber: '00112223334',
        email: 'ana@cliente.com',
        phone: '8095551234',
      },
      plan: {
        name: 'Fibra 100 Mbps',
        serviceType: 'INTERNET',
        speedMbps: 100,
        tvChannelsCount: 0,
        monthlyPrice: 1500,
      },
      address: {
        street: 'Calle Duarte',
        buildingNumber: '12',
        sector: 'Centro',
        municipality: 'Santo Domingo',
        city: 'Santo Domingo',
      },
    };

    it('genera un Buffer con la firma %PDF- válida', async () => {
      const buffer = await service.generateContractPdf(contractData);
      expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it('incluye el número de contrato, el cliente y el plan contratado', async () => {
      const buffer = await service.generateContractPdf(contractData);
      const text = extractPdfText(buffer);

      expect(text).toContain('CTR-000123');
      expect(text).toContain('Ana');
      expect(text).toContain('Fibra 100 Mbps');
    });

    it('incluye el bloque de clausulas generales placeholder', async () => {
      const buffer = await service.generateContractPdf(contractData);
      const text = extractPdfText(buffer);

      expect(text).toContain('GENERALES');
    });
  });
});
