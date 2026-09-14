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

export interface ContractPdfData {
  company: CompanyPdfInfo;
  contract: {
    contractNumber: string;
    status: string;
    startDate: string;
    endDate?: string;
    billingDay: number;
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
}
