/**
 * Formas de datos consumidas por PdfGeneratorService. No son entidades TypeORM:
 * son proyecciones ya armadas por los servicios de dominio (InvoicingService,
 * ClientsService) para desacoplar el renderizado del PDF del origen de los datos.
 */

export interface CompanyPdfInfo {
  rnc: string;
  razonSocial: string;
  nombreComercial?: string;
  direccion?: string;
  telefono?: string;
  correo?: string;
}

export interface InvoiceReceiptMetadata {
  company: CompanyPdfInfo;
  invoice: {
    id: string;
    ncfNumber?: string;
    ncfType?: string;
    // Vencimiento de la secuencia de NCF (no la fecha de cobro de la factura) —
    // solo presente en comprobantes con crédito fiscal (no E32/E34).
    ncfExpiryDate?: string;
    dgiiStatus: string;
    securityCode?: string;
    qrCodeUrl?: string;
    issuedAt: Date;
    contingencyMode: boolean;
    // Solo presentes cuando ncfType === 'E34' (Nota de Crédito): el NCF que
    // esta Nota anula y el motivo — la DGII exige que la Representación
    // Impresa los muestre de forma destacada.
    ncfModificado?: string;
    razonModificacion?: string;
  };
  client: {
    name: string;
    docNumber: string;
    docType: string;
    email: string;
  };
  sale: {
    id: string;
    paymentMethod: string;
    billingPeriod: string;
    dueDate: string;
    subtotal: number;
    discountAmount: number;
    itbisTotal: number;
    grandTotal: number;
    cashier: string;
    details: Array<{
      concept: string;
      quantity: number;
      unitPrice: number;
      itbisAmount: number;
      subtotal: number;
      unidadMedida: string;
    }>;
  };
}

export interface ContractSignatureImageInfo {
  imageBuffer: Buffer;
  signedByName: string;
  signedAt: Date;
}

export interface ClientsListPdfRow {
  nombre: string;
  tipoCliente: string;
  documento: string;
  telefono: string;
  ubicacion: string;
  planActivo: string;
  estadoContrato: string;
  estadoCliente: string;
  fechaAlta: string;
}

export interface ClientsListPdfData {
  company: CompanyPdfInfo;
  rows: ClientsListPdfRow[];
  totalExportado: number;
  generatedByUsername: string;
  generatedAt: Date;
  /** Texto legible de los filtros aplicados (ej. "Sector: Piantini · Plan: Fibra 100 · Estado: Activo"), o 'Ninguno'. */
  filtersSummary: string;
}

export interface ContractPdfData {
  company: CompanyPdfInfo;
  contract: {
    contractNumber: string;
    status: string;
    startDate: string;
    endDate?: string;
    billingDay: number;
  };
  /** Ausentes cuando esa parte todavía no firmó — la firma es opcional, el PDF nunca falla por esto. */
  signatures?: {
    client?: ContractSignatureImageInfo;
    company?: ContractSignatureImageInfo;
  };
  client: {
    name: string;
    docNumber: string;
    docType: string;
    email?: string;
    phone?: string;
  };
  plan: {
    name: string;
    serviceType: string;
    speedMbps: number;
    tvChannelsCount: number;
    monthlyPrice: number;
  };
  address: {
    street: string;
    buildingNumber?: string;
    sector: string;
    municipality: string;
    city: string;
  };
  /**
   * Presente SOLO la primera vez que se imprime este contrato tras generar o
   * resetear la contraseña del Portal de Autoservicio (ver
   * ClientsService.generateContractPdf) — la contraseña es de un solo uso:
   * una vez impresa, no vuelve a aparecer en reimpresiones posteriores.
   */
  portalCredentials?: { username: string; password: string };
}
