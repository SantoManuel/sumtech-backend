import { Injectable, Inject, NotFoundException, ConflictException, ForbiddenException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner, DataSource, Between } from 'typeorm';
import { TENANT_DATA_SOURCE } from '../../common/tenancy/tenant-datasource.provider';
import { InvoiceEntity } from './entities/invoice.entity';
import { EcfSequenceEntity } from './entities/ecf-sequence.entity';
import { SaleEntity } from '../pos/entities/sale.entity';
import { SaleDetailEntity } from '../pos/entities/sale-detail.entity';
import { Role } from '../../common/enums/role.enum';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { ProductEntity } from '../inventory/entities/product.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { ClientEntity } from '../clients/entities/client.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { PlanEntity } from '../plans/entities/plan.entity';
import { EmitInvoiceDto } from './dto/emit-invoice.dto';
import { GenerateEcfDto } from './dto/generate-ecf.dto';
import { DgiiXmlGeneratorService, EcfItemInput, UNIDAD_MEDIDA_UND, usesNcfExpiryDate, sanitizeProvincia } from './dgii/dgii-xml-generator.service';
import { DgiiClientService, DgiiSendResult } from './dgii/dgii-client.service';
import { DgiiSignerService } from './dgii/dgii-signer.service';
import { PdfGeneratorService } from '../printing/pdf-generator.service';
import { InvoiceReceiptMetadata } from '../printing/pdf-generator.types';
import { CompanyService } from '../company/company.service';
import { isOpenInvoiceStatus, OPEN_INVOICE_STATUSES } from './invoice-status.util';
import { BillingSettingsEntity } from '../billing/entities/billing-settings.entity';

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);

  constructor(
    @InjectRepository(InvoiceEntity)
    private readonly invoiceRepository: Repository<InvoiceEntity>,
    @InjectRepository(EcfSequenceEntity)
    private readonly sequenceRepository: Repository<EcfSequenceEntity>,
    @InjectRepository(SaleEntity)
    private readonly saleRepository: Repository<SaleEntity>,
    @InjectRepository(TicketEntity)
    private readonly ticketRepository: Repository<TicketEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(SerialNumberEntity)
    private readonly serialRepository: Repository<SerialNumberEntity>,
    @InjectRepository(ClientEntity)
    private readonly clientRepository: Repository<ClientEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(PlanEntity)
    private readonly planRepository: Repository<PlanEntity>,
    private readonly xmlGenerator: DgiiXmlGeneratorService,
    private readonly dgiiClient: DgiiClientService,
    private readonly signerService: DgiiSignerService,
    private readonly pdfGenerator: PdfGeneratorService,
    @Inject(TENANT_DATA_SOURCE) private readonly dataSource: DataSource,
    @Optional() private readonly companyService?: CompanyService,
  ) { }

  /**
   * Obtiene y reserva atómicamente la siguiente secuencia correlativa para el tipo de comprobante.
   * Retorna también el `expiryDate` de la secuencia (vencimiento de la autorización DGII vigente
   * al momento del timbrado) para persistirlo en la factura — no en `sale.dueDate`, que es la
   * fecha de cobro de la factura y no tiene relación con la secuencia de NCF.
   */
  async getNextNcfSequence(
    ncfType: 'E31' | 'E32' | 'E33' | 'E34' | 'E44' | 'E45' | 'B01' | 'B02',
    queryRunner?: QueryRunner,
  ): Promise<{ ncfNumber: string; expiryDate: string }> {
    const seqRepo = queryRunner
      ? queryRunner.manager.getRepository(EcfSequenceEntity)
      : this.sequenceRepository;

    let sequenceRecord = await seqRepo.findOne({ where: { ncfType } });

    if (!sequenceRecord) {
      // Inicializar secuencia por defecto si no existe
      sequenceRecord = seqRepo.create({
        ncfType,
        serie: ncfType.startsWith('E') ? 'E' : 'B',
        currentSequence: 1,
        startSequence: 1,
        endSequence: 500000,
        authorizationNumber: '6005450276',
        expiryDate: '31-12-2026',
        isActive: true,
        alertRemaining: 50,
      });
      sequenceRecord = await seqRepo.save(sequenceRecord);
    }

    const currentSeqNum = Number(sequenceRecord.currentSequence);

    if (currentSeqNum > Number(sequenceRecord.endSequence)) {
      throw new BadRequestException(
        `El rango de secuencias autorizadas para ${ncfType} se ha agotado. Contacte a la administración para renovar en DGII.`,
      );
    }

    const padLength = ncfType.startsWith('E') ? 10 : 8;
    const formattedSeq = currentSeqNum.toString().padStart(padLength, '0');
    const ncfNumber = `${ncfType}${formattedSeq}`;

    // Incrementar secuencia
    sequenceRecord.currentSequence = currentSeqNum + 1;
    await seqRepo.save(sequenceRecord);

    return { ncfNumber, expiryDate: sequenceRecord.expiryDate };
  }

  /**
   * Construye las líneas fiscales, firma y envía el e-CF a la DGII para una venta
   * ya persistida. Compartido entre emitInvoice() (venta+factura ad-hoc, timbrado
   * inmediato) y settleInvoice() (liquidación de una factura recurrente PENDING_PAYMENT
   * ya existente) para no duplicar la lógica de construcción/envío del e-CF.
   */
  private async buildEcfPayload(
    sale: SaleEntity,
    ncfType: 'E31' | 'E32' | 'E33' | 'E34' | 'E44' | 'E45' | 'B01' | 'B02',
    options?: {
      ncfModificado?: string;
      fechaNcfModificado?: string;
      codigoModificacion?: '1' | '2' | '3' | '4' | '5';
      razonModificacion?: string;
      indicadorNotaCredito?: '0' | '1';
      // CDT (Contribución al Desarrollo de las Telecomunicaciones, Ley 153-98 Art.
      // 45, código DGII '002') u otro impuesto adicional propio de la factura.
      cdtAmount?: number;
      cdtTasa?: number;
    },
    queryRunner?: QueryRunner,
  ) {
    // 1. Obtener correlativo autorizado
    const { ncfNumber, expiryDate: sequenceExpiryDate } = await this.getNextNcfSequence(ncfType, queryRunner);

    if (!sale.client && sale.clientId && this.clientRepository) {
      try {
        const foundClient = await this.clientRepository.findOne({ where: { id: sale.clientId } });
        if (foundClient) {
          sale.client = foundClient;
        }
      } catch {
        // Ignorar si el repositorio de cliente no está disponible en este contexto
      }
    }

    // 2. Mapear líneas de detalle al formato fiscal DGII
    const ecfItems: EcfItemInput[] = (sale.details || []).map((detail, index) => {
      const isHardware = detail.itemType === 'PRODUCT_HARDWARE';
      const isExempt = Number(detail.itbisAmount) === 0;
      return {
        numeroLinea: index + 1,
        nombreItem: detail.concept,
        indicadorBienoServicio: isHardware ? '1' : '2',
        indicadorFacturacion: isExempt ? '4' : '1', // 1=18% gravado, 4=exento
        cantidad: Number(detail.quantity),
        precioUnitario: Number(detail.unitPrice),
        montoItem: Number(detail.subtotal),
        itbisRate: isExempt ? 0 : 0.18,
        itbisMonto: Number(detail.itbisAmount),
        unidadMedida: isHardware ? UNIDAD_MEDIDA_UND : undefined,
      };
    });

    if (ecfItems.length === 0) {
      ecfItems.push({
        numeroLinea: 1,
        nombreItem: 'Servicio de Internet Fibra Óptica',
        indicadorBienoServicio: '2',
        indicadorFacturacion: '1',
        cantidad: 1,
        precioUnitario: Number(sale.subtotal),
        montoItem: Number(sale.subtotal),
        itbisRate: 0.18,
        itbisMonto: Number(sale.itbisTotal),
      });
    }

    const cdtAmount = Number(options?.cdtAmount || 0);
    if (cdtAmount > 0) {
      ecfItems[0].tiposImpuestoAdicional = ['002'];
    }

    const dgiiCfg = await this.dgiiClient.getConfig();
    let effectiveConfig = dgiiCfg;
    if (this.companyService) {
      const fiscal = await this.companyService.getCompanyFiscalInfo();
      effectiveConfig = {
        ...dgiiCfg,
        rncEmisor: fiscal.rnc || dgiiCfg.rncEmisor,
        razonSocialEmisor: fiscal.razonSocial || dgiiCfg.razonSocialEmisor,
        nombreComercial: fiscal.nombreComercial || dgiiCfg.nombreComercial,
        direccionEmisor: fiscal.direccion || dgiiCfg.direccionEmisor,
        municipioEmisor: fiscal.municipio || dgiiCfg.municipioEmisor,
        provinciaEmisor: sanitizeProvincia(fiscal.provincia || dgiiCfg.provinciaEmisor),
        correoEmisor: fiscal.correo || dgiiCfg.correoEmisor,
        telefonoEmisor: fiscal.telefono || dgiiCfg.telefonoEmisor,
        webSite: fiscal.website || dgiiCfg.webSite,
      };
    }

    // 3. Generar XML e-CF conforme a XSD
    const ecfPayload = {
      ncfType,
      eNcf: ncfNumber,
      fechaEmision: new Date(),
      rncComprador: sale.client?.docNumber,
      razonSocialComprador: sale.client?.name || 'Consumidor Final',
      correoComprador: sale.client?.email,
      ncfModificado: options?.ncfModificado,
      fechaNcfModificado: options?.fechaNcfModificado,
      codigoModificacion: options?.codigoModificacion,
      razonModificacion: options?.razonModificacion,
      indicadorNotaCredito: options?.indicadorNotaCredito,
      items: ecfItems,
      impuestosAdicionales:
        cdtAmount > 0 ? [{ tipoImpuesto: '002', tasa: Number(options?.cdtTasa || 0), monto: cdtAmount }] : undefined,
      fechaVencimientoSecuencia: sequenceExpiryDate,
    };

    const rawXml = this.companyService
      ? this.xmlGenerator.generateEcfXml(ecfPayload, effectiveConfig)
      : this.xmlGenerator.generateEcfXml(ecfPayload);

    // 4. Firmar digitalmente y enviar a los servicios web de la DGII
    // Conforme a la normativa oficial DGII y validado en certificación:
    // Las facturas de consumo menor (< RD$250,000, tipo E32) se envían como RFCE
    // a través del canal dedicado fc.dgii.gov.do (baseUrlRfce).
    const isConsumoMenor = ncfType === 'E32' && Number(sale.grandTotal) < 250000;
    let sendResult: DgiiSendResult;
    let baseSignedXml: string | undefined;
    let baseSecurityCode: string | undefined;

    if (isConsumoMenor) {
      // 1. Firmar el e-CF base subyacente para extraer su Código de Seguridad real (6 caracteres)
      const dgiiConfig = await this.dgiiClient.getConfig();
      const signedBase = this.signerService.signXml(rawXml, dgiiConfig.certPath, dgiiConfig.certPassword);
      baseSecurityCode = signedBase.securityCode;
      baseSignedXml = signedBase.signedXml;

      // 2. Construir el Resumen RFCE conforme al esquema oficial rfce-32.xsd
      const rfceRawXml = this.xmlGenerator.generateRfceXml(
        ncfNumber,
        effectiveConfig.rncEmisor,
        Number(sale.grandTotal),
        Number(sale.itbisTotal),
        baseSecurityCode,
        {
          razonSocialEmisor: effectiveConfig.razonSocialEmisor,
          fechaEmision: this.formatDateDgii(new Date()),
          rncComprador: sale.client?.docNumber,
          razonSocialComprador: sale.client?.name || 'Consumidor Final',
          montoGravadoTotal: Number(sale.subtotal),
          montoGravadoI1: Number(sale.subtotal),
          totalItbis1: Number(sale.itbisTotal),
        },
      );

      // 3. Transmitir el Resumen RFCE por el canal oficial fc.dgii.gov.do
      sendResult = await this.dgiiClient.submitRfce(rfceRawXml, ncfNumber, Number(sale.grandTotal));
    } else {
      sendResult = await this.dgiiClient.submitEcf(
        rawXml,
        ncfNumber,
        Number(sale.grandTotal),
        ncfType,
        sale.client?.docNumber,
      );
    }

    return {
      ncfNumber,
      ncfType,
      // Vencimiento de la secuencia de NCF autorizada al momento del timbrado —
      // no confundir con la fecha de cobro de la factura (sale.dueDate). Solo
      // aplica a comprobantes con crédito fiscal (no E32/E34).
      ncfExpiryDate: usesNcfExpiryDate(ncfType) ? sequenceExpiryDate : undefined,
      dgiiStatus: sendResult.status,
      dgiiTrackId: sendResult.trackId,
      securityCode: baseSecurityCode || sendResult.securityCode,
      qrCodeContent:
        isConsumoMenor && baseSecurityCode && typeof this.dgiiClient.generateQrCodeUrl === 'function'
          ? this.dgiiClient.generateQrCodeUrl(effectiveConfig, ncfNumber, Number(sale.grandTotal), baseSecurityCode, new Date())
          : sendResult.qrCodeUrl,
      signedXmlContent: baseSignedXml || sendResult.signedXml,
      responseMessage: sendResult.responseMessage,
      dgiiResponse: sendResult.rawResponse,
      contingencyMode: sendResult.status === 'CONTINGENCY',
      buyerDocType: sale.client?.docType,
      buyerDocNumber: sale.client?.docNumber,
      buyerName: sale.client?.name,
      taxSummary: {
        montoGravadoTotal: Number(sale.subtotal),
        montoGravadoI1: Number(sale.subtotal),
        montoGravadoI2: 0,
        montoExento: 0,
        totalITBIS: Number(sale.itbisTotal),
        totalITBIS1: Number(sale.itbisTotal),
        montoTotal: Number(sale.grandTotal),
      },
    };
  }

  /**
   * Timbra una venta realizada en el POS generando el e-CF conforme a la DGII
   */
  async emitInvoice(dto: EmitInvoiceDto, queryRunner?: QueryRunner): Promise<InvoiceEntity> {
    const invoiceRepo = queryRunner ? queryRunner.manager.getRepository(InvoiceEntity) : this.invoiceRepository;
    const saleRepo = queryRunner ? queryRunner.manager.getRepository(SaleEntity) : this.saleRepository;

    const sale = await saleRepo.findOne({
      where: { id: dto.saleId },
      relations: ['client', 'details'],
    });

    if (!sale) {
      throw new NotFoundException(`Venta con ID ${dto.saleId} no encontrada`);
    }

    const existingInvoice = await invoiceRepo.findOne({ where: { saleId: dto.saleId } });
    if (existingInvoice) {
      throw new ConflictException(`La venta ${dto.saleId} ya cuenta con una factura emitida (${existingInvoice.ncfNumber})`);
    }

    const ecfPayload = await this.buildEcfPayload(sale, dto.ncfType, dto, queryRunner);

    // Venta+factura ad-hoc (hardware/instalación/reparación): se paga y se timbra
    // atómicamente, sin pasar por el estado PENDING_PAYMENT.
    const invoice = invoiceRepo.create({
      saleId: sale.id,
      clientId: sale.clientId,
      contractId: sale.contractId,
      status: 'ISSUED',
      subtotal: Number(sale.subtotal),
      itbisTotal: Number(sale.itbisTotal),
      grandTotal: Number(sale.grandTotal),
      paidAt: new Date(),
      ...ecfPayload,
      issuedAt: new Date(),
    });

    return invoiceRepo.save(invoice);
  }

  /**
   * Liquida una factura recurrente PENDING_PAYMENT: asigna el correlativo NCF y
   * timbra ante la DGII solo en este momento (nunca al generarse la factura),
   * preservando el correlativo secuencial exigido. `sale` debe ser una venta ya
   * persistida (creada por el llamador, ej. PosService.collectInvoices) cuyos
   * montos coincidan exactamente con los de la factura.
   */
  async settleInvoice(
    invoiceId: string,
    sale: SaleEntity,
    ncfType: 'E31' | 'E32' | 'E33' | 'E34' | 'E44' | 'E45' | 'B01' | 'B02',
    queryRunner?: QueryRunner,
  ): Promise<InvoiceEntity> {
    const invoiceRepo = queryRunner ? queryRunner.manager.getRepository(InvoiceEntity) : this.invoiceRepository;

    const invoice = await invoiceRepo.findOne({
      where: { id: invoiceId },
      relations: ['client'],
    });
    if (!invoice) {
      throw new NotFoundException(`Factura con ID ${invoiceId} no encontrada`);
    }
    if (!isOpenInvoiceStatus(invoice.status)) {
      throw new ConflictException(
        `La factura ${invoiceId} no está pendiente de pago (estado actual: ${invoice.status})`,
      );
    }

    if (!sale.client && invoice.client) {
      sale.client = invoice.client;
    }

    const cdtAmount = Number(invoice.cdtAmount || 0);
    const invoiceSubtotal = Number(invoice.subtotal || 0);
    const cdtTasa = cdtAmount > 0 && invoiceSubtotal > 0 ? (cdtAmount / invoiceSubtotal) * 100 : 0;

    const ecfPayload = await this.buildEcfPayload(sale, ncfType, { cdtAmount, cdtTasa }, queryRunner);

    Object.assign(invoice, ecfPayload, {
      saleId: sale.id,
      status: 'ISSUED' as const,
      paidAt: new Date(),
    });

    return invoiceRepo.save(invoice);
  }

  /**
   * Anula una factura PENDING_PAYMENT generada por error, antes de que tenga
   * NCF asignado — sin impacto fiscal. Una factura ya ISSUED (e-CF timbrado
   * ante la DGII) no puede anularse por esta vía: legalmente requiere una
   * Nota de Crédito (E34), fuera de alcance de este método.
   */
  async voidInvoice(invoiceId: string): Promise<InvoiceEntity> {
    const invoice = await this.invoiceRepository.findOne({ where: { id: invoiceId } });
    if (!invoice) {
      throw new NotFoundException(`Factura con ID ${invoiceId} no encontrada`);
    }
    if (!isOpenInvoiceStatus(invoice.status)) {
      throw new ConflictException(
        `Solo se pueden anular facturas pendientes de pago (PENDING_PAYMENT/EN_GRACIA/VENCIDA) — estado actual: ${invoice.status}. Una factura ISSUED requiere una Nota de Crédito.`,
      );
    }
    invoice.status = 'VOIDED';
    return this.invoiceRepository.save(invoice);
  }

  /**
   * Anula ante la DGII una factura ya ISSUED (e-CF timbrado) emitiendo una
   * Nota de Crédito (E34, CodigoModificacion=1 "Anula el NCF modificado") que
   * referencia la factura original — la única forma legal de reversar un e-CF
   * ya aceptado (no se edita ni se borra el original, que permanece ISSUED
   * para siempre como registro fiscal). Los montos de la Nota de Crédito
   * espejan exactamente los de la factura original (positivos, la reversión
   * se marca por tipo de documento + InformacionReferencia, no por signo).
   *
   * CAJERO solo puede anular facturas que él mismo cobró y dentro de las 48
   * horas de emitidas; ADMIN/GERENTE no tienen esa restricción.
   */
  async createCreditNote(
    originalInvoiceId: string,
    razonModificacion: string,
    requestingUserId: string,
    requestingRoles: string[],
  ): Promise<InvoiceEntity> {
    const original = await this.invoiceRepository.findOne({
      where: { id: originalInvoiceId },
      relations: ['sale', 'sale.details'],
    });
    if (!original) {
      throw new NotFoundException(`Factura con ID ${originalInvoiceId} no encontrada`);
    }
    if (original.ncfType === 'E34') {
      throw new ConflictException(
        'No se puede emitir una Nota de Crédito sobre otra Nota de Crédito. Referencia la factura original.',
      );
    }
    if (original.status !== 'ISSUED') {
      throw new ConflictException(
        `Solo se pueden anular ante la DGII facturas ISSUED (estado actual: ${original.status}). Una PENDING_PAYMENT se anula con el endpoint de anulación directa.`,
      );
    }

    const existingCreditNote = await this.invoiceRepository.findOne({ where: { originalInvoiceId } });
    if (existingCreditNote) {
      throw new ConflictException(
        `La factura ${original.ncfNumber} ya tiene una Nota de Crédito emitida (${existingCreditNote.ncfNumber})`,
      );
    }

    const isSupervisor = requestingRoles.includes(Role.ADMIN) || requestingRoles.includes(Role.GERENTE);
    if (!isSupervisor) {
      if (original.sale?.userId !== requestingUserId) {
        throw new ForbiddenException('Solo puedes anular ante la DGII facturas que tú mismo procesaste.');
      }
      const hoursSinceIssued = (Date.now() - new Date(original.issuedAt).getTime()) / (1000 * 60 * 60);
      let voidWindowHours = 48;
      try {
        const billingRepo = this.dataSource.getRepository(BillingSettingsEntity);
        const settings = await billingRepo.findOne({ where: {} });
        if (settings && typeof settings.cashierVoidWindowHours === 'number') {
          voidWindowHours = settings.cashierVoidWindowHours;
        }
      } catch (err: any) {
        this.logger.warn(`No se pudo leer cashierVoidWindowHours de BillingSettingsEntity: ${err?.message}`);
      }

      if (hoursSinceIssued > voidWindowHours) {
        throw new ConflictException(
          `Esta factura tiene más de ${voidWindowHours} horas desde su emisión — solo un ADMIN o GERENTE puede anularla.`,
        );
      }
    }

    const daysSinceIssued = Math.floor(
      (Date.now() - new Date(original.issuedAt).getTime()) / (1000 * 60 * 60 * 24),
    );
    const indicadorNotaCredito: '0' | '1' = daysSinceIssued <= 30 ? '0' : '1';

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const saleDetailRepo = queryRunner.manager.getRepository(SaleDetailEntity);
      const saleRepo = queryRunner.manager.getRepository(SaleEntity);

      const mirroredDetails = (original.sale?.details || []).map((d) =>
        saleDetailRepo.create({
          itemType: d.itemType,
          itemId: d.itemId,
          concept: d.concept,
          quantity: d.quantity,
          unitPrice: d.unitPrice,
          itbisAmount: d.itbisAmount,
          subtotal: d.subtotal,
        }),
      );

      const creditSale = saleRepo.create({
        clientId: original.clientId,
        contractId: original.contractId,
        userId: requestingUserId,
        subtotal: Number(original.subtotal || 0),
        itbisTotal: Number(original.itbisTotal || 0),
        grandTotal: Number(original.grandTotal || 0),
        paymentMethod: original.sale?.paymentMethod || 'CASH',
        status: 'PAID',
        notes: `Nota de Crédito — Anulación de factura ${original.ncfNumber}`,
        details: mirroredDetails,
      });
      const savedCreditSale = await saleRepo.save(creditSale);

      const cdtAmount = Number(original.cdtAmount || 0);
      const originalSubtotal = Number(original.subtotal || 0);
      const cdtTasa = cdtAmount > 0 && originalSubtotal > 0 ? (cdtAmount / originalSubtotal) * 100 : 0;

      const ecfPayload = await this.buildEcfPayload(
        savedCreditSale,
        'E34',
        {
          ncfModificado: original.ncfNumber,
          fechaNcfModificado: this.formatDateDgii(original.issuedAt),
          codigoModificacion: '1',
          razonModificacion,
          indicadorNotaCredito,
          cdtAmount,
          cdtTasa,
        },
        queryRunner,
      );

      const creditNoteInvoice = queryRunner.manager.getRepository(InvoiceEntity).create({
        saleId: savedCreditSale.id,
        clientId: original.clientId,
        contractId: original.contractId,
        status: 'ISSUED' as const,
        originalInvoiceId: original.id,
        ncfModificado: original.ncfNumber,
        codigoModificacion: '1' as const,
        razonModificacion,
        subtotal: originalSubtotal,
        itbisTotal: Number(original.itbisTotal || 0),
        cdtAmount,
        grandTotal: Number(original.grandTotal || 0),
        concept: `Nota de Crédito — Anulación de factura ${original.ncfNumber}`,
        paidAt: new Date(),
        ...ecfPayload,
      });
      const saved = await queryRunner.manager.getRepository(InvoiceEntity).save(creditNoteInvoice);

      await queryRunner.commitTransaction();
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error emitiendo Nota de Crédito para la factura ${originalInvoiceId}: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private formatDateDgii(date: Date): string {
    const d = new Date(date);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${d.getFullYear()}`;
  }

  private normalizeSalePaymentMethod(
    pm?: string,
  ): 'CASH' | 'CARD_DEBIT' | 'CARD_CREDIT' | 'BANK_TRANSFER' | 'MIXED' {
    if (!pm) return 'CASH';
    const upper = pm.toUpperCase().trim();
    if (upper === 'TRANSFER' || upper === 'TRANSFERENCIA' || upper === 'BANK_TRANSFER') return 'BANK_TRANSFER';
    if (upper === 'CARD_CREDIT' || upper === 'CREDIT' || upper === 'TC') return 'CARD_CREDIT';
    if (upper === 'CARD_DEBIT' || upper === 'CARD' || upper === 'TARJETA' || upper === 'TD') return 'CARD_DEBIT';
    if (upper === 'MIXED' || upper === 'MIXTO') return 'MIXED';
    return 'CASH';
  }

  async findAll(dto: {
    page?: number;
    limit?: number;
    status?: string;
    openOnly?: boolean;
    clientId?: string;
    search?: string;
    dueDateFrom?: string;
    dueDateTo?: string;
    dueStatus?: 'OVERDUE' | 'UPCOMING';
    upcomingDays?: number;
    sectorId?: string;
    sortBy?: 'issuedAt' | 'dueDate';
    sortDir?: 'ASC' | 'DESC';
  }) {
    const page = dto.page || 1;
    const limit = dto.limit || 15;
    const skip = (page - 1) * limit;

    const query = this.invoiceRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.client', 'client')
      .leftJoinAndSelect('invoice.contract', 'contract')
      .leftJoinAndSelect('contract.plan', 'plan')
      .leftJoinAndSelect('invoice.sale', 'sale')
      .leftJoinAndSelect('invoice.creditNote', 'creditNote')
      .leftJoin('client.addresses', 'address', 'address.isPrimary = true')
      .orderBy(`invoice.${dto.sortBy || 'issuedAt'}`, dto.sortDir || 'DESC')
      .skip(skip)
      .take(limit);

    if (dto.openOnly) {
      // "todavía debe pagarse" — usado por el listado cross-cliente de
      // facturas cobrables del POS, que debe seguir mostrando una factura aun
      // cuando envejece de PENDING_PAYMENT a EN_GRACIA/VENCIDA.
      query.andWhere('invoice.status IN (:...openStatuses)', { openStatuses: OPEN_INVOICE_STATUSES });
    } else if (dto.status) {
      query.andWhere('invoice.status = :status', { status: dto.status });
    }
    if (dto.clientId) {
      query.andWhere('invoice.clientId = :clientId', { clientId: dto.clientId });
    }
    if (dto.dueDateFrom) {
      query.andWhere('invoice.dueDate >= :dueDateFrom', { dueDateFrom: dto.dueDateFrom });
    }
    if (dto.dueDateTo) {
      query.andWhere('invoice.dueDate <= :dueDateTo', { dueDateTo: dto.dueDateTo });
    }
    if (dto.dueStatus === 'OVERDUE') {
      query.andWhere('invoice.dueDate < CURRENT_DATE');
    } else if (dto.dueStatus === 'UPCOMING') {
      const upcomingDays = dto.upcomingDays || 7;
      query.andWhere("invoice.dueDate BETWEEN CURRENT_DATE AND CURRENT_DATE + make_interval(days => :upcomingDays)", {
        upcomingDays,
      });
    }
    if (dto.sectorId) {
      query.andWhere('address.sectorId = :sectorId', { sectorId: dto.sectorId });
    }
    if (dto.search) {
      query.andWhere('(client.name ILIKE :search OR client.docNumber ILIKE :search OR invoice.ncfNumber ILIKE :search)', {
        search: `%${dto.search}%`,
      });
    }

    const [data, total] = await query.getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findBySaleId(saleId: string): Promise<InvoiceEntity> {
    const invoice = await this.invoiceRepository.findOne({
      where: { saleId },
      relations: ['sale', 'sale.client', 'sale.details', 'sale.user'],
    });
    if (!invoice) {
      throw new NotFoundException(`Factura no encontrada para la venta ${saleId}`);
    }
    return invoice;
  }

  async findById(id: string): Promise<InvoiceEntity> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id },
      // 'client'/'contract'/'contract.plan' se cargan siempre (existen en la
      // propia factura desde su generación); 'sale.*' solo aplica una vez
      // liquidada (ISSUED) — para PENDING_PAYMENT esas relaciones son null.
      relations: [
        'client',
        'contract',
        'contract.plan',
        'sale',
        'sale.client',
        'sale.details',
        'sale.user',
        'originalInvoice',
        'creditNote',
      ],
    });
    if (!invoice) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`);
    }
    return invoice;
  }

  /**
   * Sincroniza el estado fiscal de la factura con la DGII consultando su TrackID.
   * Actualiza dgiiStatus, responseMessage y dgiiResponse en la base de datos.
   */
  async syncDgiiStatus(id: string): Promise<InvoiceEntity> {
    const invoice = await this.findById(id);
    if (!invoice.dgiiTrackId) {
      throw new BadRequestException(
        `La factura ${invoice.ncfNumber || id} no cuenta con un TrackID de la DGII para consultar.`,
      );
    }

    const queryResult = await this.dgiiClient.queryTrackIdStatus(invoice.dgiiTrackId);

    const estadoStr = String(queryResult?.estado || queryResult?.status || '').toUpperCase();
    if (
      estadoStr === 'ACEPTADO' ||
      estadoStr === '0' ||
      estadoStr.includes('APROB') ||
      estadoStr.includes('ACEPT')
    ) {
      invoice.dgiiStatus = 'ACCEPTED';
      invoice.contingencyMode = false;
    } else if (estadoStr === 'RECHAZADO' || estadoStr.includes('RECHAZ')) {
      invoice.dgiiStatus = 'REJECTED';
    } else if (estadoStr === 'CONTINGENCIA') {
      invoice.dgiiStatus = 'CONTINGENCY';
    }

    if (queryResult?.mensaje) {
      invoice.responseMessage = queryResult.mensaje;
    }
    invoice.dgiiResponse = queryResult;

    return this.invoiceRepository.save(invoice);
  }

  /**
   * Obtiene el XML firmado de la factura para descarga o integración fiscal.
   */
  async getInvoiceXml(id: string): Promise<{ filename: string; xmlContent: string }> {
    const invoice = await this.findById(id);
    if (!invoice.signedXmlContent) {
      throw new NotFoundException(
        `No existe XML firmado registrado para la factura ${invoice.ncfNumber || id}.`,
      );
    }
    const filename = `${invoice.ncfNumber || id}.xml`;
    return { filename, xmlContent: invoice.signedXmlContent };
  }

  /**
   * Obtiene el estado y disponibilidad de las secuencias autorizadas
   */
  async getAvailableSequences() {
    let sequences = await this.sequenceRepository.find({ order: { ncfType: 'ASC' } });

    if (sequences.length === 0) {
      const defaultTypes: Array<'E31' | 'E32' | 'E33' | 'E34' | 'E44' | 'E45' | 'B01' | 'B02'> = [
        'E31', 'E32', 'E33', 'E34', 'E44', 'E45', 'B01', 'B02'
      ];
      for (const t of defaultTypes) {
        await this.sequenceRepository.save(
          this.sequenceRepository.create({
            ncfType: t,
            serie: t.startsWith('E') ? 'E' : 'B',
            currentSequence: 1,
            startSequence: 1,
            endSequence: 100000,
            authorizationNumber: '6005450276',
            expiryDate: '31-12-2026',
            isActive: true,
          })
        );
      }
      sequences = await this.sequenceRepository.find({ order: { ncfType: 'ASC' } });
    }

    return sequences.map((s) => {
      const current = Number(s.currentSequence);
      const end = Number(s.endSequence);
      const remaining = Math.max(0, end - current + 1);
      return {
        id: s.id,
        ncfType: s.ncfType,
        serie: s.serie,
        currentSequence: current,
        endSequence: end,
        remaining,
        expiryDate: s.expiryDate,
        isCritical: remaining <= s.alertRemaining,
        isActive: s.isActive,
      };
    });
  }

  /**
   * Metadatos para impresión de Ticket Térmico 80mm o Representación Impresa PDF
   */
  async getReceiptMetadata(invoiceId: string): Promise<InvoiceReceiptMetadata> {
    const invoice = await this.findById(invoiceId);

    let company: {
      rnc: string;
      razonSocial: string;
      nombreComercial?: string;
      direccion?: string;
      telefono?: string;
      correo?: string;
    };

    if (this.companyService) {
      const fiscal = await this.companyService.getCompanyFiscalInfo();
      const razonSocial = fiscal.razonSocial?.trim() || 'SUMTECH TELECOM S.R.L.';
      const nombreComercial = fiscal.nombreComercial?.trim();
      company = {
        rnc: fiscal.rnc || '131148697',
        razonSocial,
        nombreComercial: nombreComercial && nombreComercial !== razonSocial ? nombreComercial : undefined,
        direccion: fiscal.direccion,
        telefono: fiscal.telefono,
        correo: fiscal.correo,
      };
    } else {
      const config = await this.dgiiClient.getConfig();
      const razonSocial = config.razonSocialEmisor?.trim() || 'SUMTECH TELECOM S.R.L.';
      const nombreComercial = config.nombreComercial?.trim();
      company = {
        rnc: config.rncEmisor || '131148697',
        razonSocial,
        nombreComercial: nombreComercial && nombreComercial !== razonSocial ? nombreComercial : undefined,
        direccion: config.direccionEmisor,
        telefono: config.telefonoEmisor,
        correo: config.correoEmisor,
      };
    }

    const isIssued = invoice.status === 'ISSUED';

    // CASO 1: Factura emitida y cobrada (o con venta asociada en el POS)
    if (isIssued || invoice.sale) {
      const sale = invoice.sale;

      // Vigencia de secuencia DGII obligatoria para comprobantes con crédito fiscal (E31 / B01)
      const isExpiryRequired = usesNcfExpiryDate(invoice.ncfType || '');
      let effectiveNcfExpiryDate = invoice.ncfExpiryDate;
      if (isExpiryRequired && !effectiveNcfExpiryDate) {
        try {
          const seq = await this.sequenceRepository.findOne({ where: { ncfType: invoice.ncfType as any } });
          effectiveNcfExpiryDate = seq?.expiryDate || '31-12-2028';
        } catch {
          effectiveNcfExpiryDate = '31-12-2028';
        }
      }

      // Código QR oficial DGII: regenerar si está vacío o si proviene de seed/dummy sin parámetros
      let qrCodeUrl = invoice.qrCodeContent;
      const isLegacyDummy = !qrCodeUrl || qrCodeUrl.includes('/consulta?encf=') || (!qrCodeUrl.includes('codigoseguridad') && !qrCodeUrl.includes('consultatimbrefc'));
      if (isLegacyDummy && invoice.ncfNumber) {
        try {
          const config = await this.dgiiClient.getConfig();
          qrCodeUrl = this.dgiiClient.generateQrCodeUrl(
            config,
            invoice.ncfNumber,
            Number(invoice.grandTotal || sale?.grandTotal || 0),
            invoice.securityCode || '000000',
            invoice.issuedAt || invoice.paidAt || new Date(),
            invoice.client?.docNumber || sale?.client?.docNumber,
          );
        } catch {
          // Mantener qrCodeUrl actual si falla
        }
      }

      // Detalle de ítems con fallback robusto
      const saleDetails = (sale?.details && sale.details.length > 0)
        ? sale.details.map((d) => ({
            concept: d.concept,
            quantity: d.quantity,
            unitPrice: Number(d.unitPrice),
            itbisAmount: Number(d.itbisAmount),
            subtotal: Number(d.subtotal),
            unidadMedida: d.itemType === 'PRODUCT_HARDWARE' ? 'UND' : 'SERV',
          }))
        : [
            {
              concept: invoice.concept || (invoice.contract?.plan?.name ? `${invoice.contract.plan.name} - Mensualidad de servicio` : 'Servicio de Telecomunicaciones de Internet'),
              quantity: 1,
              unitPrice: Number(invoice.subtotal || sale?.subtotal || 0),
              itbisAmount: Number(invoice.itbisTotal || sale?.itbisTotal || 0),
              subtotal: Number(invoice.subtotal || sale?.subtotal || 0),
              unidadMedida: 'SERV',
            },
          ];

      return {
        company,
        invoice: {
          id: invoice.id,
          ncfNumber: invoice.ncfNumber,
          ncfType: invoice.ncfType,
          ncfExpiryDate: effectiveNcfExpiryDate,
          dgiiStatus: invoice.dgiiStatus || 'ACCEPTED',
          securityCode: invoice.securityCode || '000000',
          qrCodeUrl,
          issuedAt: invoice.issuedAt || invoice.paidAt || new Date(),
          contingencyMode: invoice.contingencyMode,
          ncfModificado: invoice.ncfModificado,
          razonModificacion: invoice.razonModificacion,
          isProforma: false,
        },
        client: {
          name: sale?.client?.name || invoice.client?.name || 'Consumidor Final',
          docNumber: sale?.client?.docNumber || invoice.client?.docNumber || '000000000',
          docType: sale?.client?.docType || invoice.client?.docType || 'Documento',
          email: sale?.client?.email || invoice.client?.email || 'N/A',
        },
        sale: {
          id: sale?.id || `sale-${invoice.id}`,
          paymentMethod: sale?.paymentMethod || 'Contado',
          billingPeriod: sale?.billingPeriod || invoice.billingPeriodStart || 'Mes Actual',
          dueDate: sale?.dueDate || invoice.dueDate || 'N/A',
          subtotal: Number(sale?.subtotal ?? invoice.subtotal ?? 0),
          discountAmount: Number(sale?.discountAmount || 0),
          itbisTotal: Number(sale?.itbisTotal ?? invoice.itbisTotal ?? 0),
          grandTotal: Number(sale?.grandTotal ?? invoice.grandTotal ?? 0),
          cashier: sale?.user?.username || 'Caja Sumtech',
          details: saleDetails,
        },
      };
    }

    // CASO 2: Factura pendiente de pago (PENDING_PAYMENT, EN_GRACIA, VENCIDA)
    // Se proyecta como Aviso de Cobro / Factura Proforma sin consumir secuencias de la DGII
    const client = invoice.client;
    const contract = invoice.contract;
    const subtotal = Number(invoice.subtotal || 0);
    const itbisTotal = Number(invoice.itbisTotal || 0);
    const grandTotal = Number(invoice.grandTotal || (subtotal + itbisTotal));
    const concept = invoice.concept || (contract?.plan?.name ? `${contract.plan.name} - Mensualidad de servicio` : 'Cargo recurrente de servicio');

    let billingPeriod = 'Mes Actual';
    if (invoice.billingPeriodStart && invoice.billingPeriodEnd) {
      billingPeriod = `${invoice.billingPeriodStart} al ${invoice.billingPeriodEnd}`;
    } else if (invoice.billingPeriodStart) {
      billingPeriod = `Período desde ${invoice.billingPeriodStart}`;
    }

    return {
      company,
      invoice: {
        id: invoice.id,
        ncfNumber: invoice.ncfNumber || `AVISO-${invoice.id.slice(0, 8).toUpperCase()}`,
        ncfType: invoice.ncfType || 'AVISO DE COBRO',
        ncfExpiryDate: undefined,
        dgiiStatus: invoice.status || 'PENDING_PAYMENT',
        securityCode: 'PROFORMA',
        qrCodeUrl: undefined,
        issuedAt: invoice.billingPeriodStart ? new Date(invoice.billingPeriodStart) : new Date(),
        contingencyMode: false,
        isProforma: true,
      },
      client: {
        name: client?.name || 'Abonado / Suscriptor',
        docNumber: client?.docNumber || 'N/A',
        docType: client?.docType || 'DOCUMENTO',
        email: client?.email || 'N/A',
      },
      sale: {
        id: `proforma-${invoice.id}`,
        paymentMethod: 'PENDIENTE DE PAGO',
        billingPeriod,
        dueDate: invoice.dueDate || 'Al Vencimiento',
        subtotal,
        discountAmount: 0,
        itbisTotal,
        grandTotal,
        cashier: 'Facturación Automática',
        details: [
          {
            concept,
            quantity: 1,
            unitPrice: subtotal,
            itbisAmount: itbisTotal,
            subtotal,
            unidadMedida: 'SERV',
          },
        ],
      },
    };
  }

  /**
   * Emite una factura e-CF directa desde el módulo de Facturación (/dashboard/facturas)
   * creando la venta asociada, asignando e-NCF correlativo, firmando con certificado DGII
   * y timbrando ante los servicios web de la DGII.
   */
  async emitDirect(dto: {
    clientId: string;
    ncfType: 'E31' | 'E32' | 'B01' | 'B02';
    concept: string;
    subtotal: number;
    itbisAmount?: number;
    paymentMethod?: string;
    userId?: string;
  }): Promise<InvoiceEntity> {
    const client = await this.clientRepository.findOne({ where: { id: dto.clientId } });
    if (!client) {
      throw new NotFoundException(`Cliente con ID ${dto.clientId} no encontrado`);
    }

    const subtotal = Number(dto.subtotal || 0);
    if (subtotal <= 0) {
      throw new BadRequestException('El subtotal de la factura debe ser mayor a cero');
    }

    const isExempt = dto.ncfType === 'E32' && dto.itbisAmount === 0;
    const itbisTotal = dto.itbisAmount !== undefined ? Number(dto.itbisAmount) : (isExempt ? 0 : Number((subtotal * 0.18).toFixed(2)));
    const grandTotal = Number((subtotal + itbisTotal).toFixed(2));
    const paymentMethod = this.normalizeSalePaymentMethod(dto.paymentMethod);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const saleRepo = queryRunner.manager.getRepository(SaleEntity);
      const detailRepo = queryRunner.manager.getRepository(SaleDetailEntity);
      const invoiceRepo = queryRunner.manager.getRepository(InvoiceEntity);

      const sale = saleRepo.create({
        clientId: client.id,
        userId: dto.userId || null,
        subtotal,
        itbisTotal,
        grandTotal,
        paymentMethod,
        status: 'PAID',
        paidAt: new Date(),
        notes: `Factura e-CF emitida directamente: ${dto.concept}`,
      } as any) as unknown as SaleEntity;
      const savedSale = await saleRepo.save(sale);

      const detail = detailRepo.create({
        saleId: savedSale.id,
        concept: dto.concept || 'Servicio de Telecomunicaciones de Internet',
        itemType: 'PLAN_SUBSCRIPTION',
        quantity: 1,
        unitPrice: subtotal,
        itbisAmount: itbisTotal,
        subtotal,
      } as any) as unknown as SaleDetailEntity;
      await detailRepo.save(detail);
      savedSale.details = [detail];
      savedSale.client = client;

      const ecfPayload = await this.buildEcfPayload(savedSale, dto.ncfType, undefined, queryRunner);

      const invoice = invoiceRepo.create({
        saleId: savedSale.id,
        clientId: client.id,
        status: 'ISSUED',
        subtotal,
        itbisTotal,
        grandTotal,
        concept: dto.concept,
        paidAt: new Date(),
        issuedAt: new Date(),
        ...ecfPayload,
      } as any) as unknown as InvoiceEntity;

      const savedInvoice = await invoiceRepo.save(invoice);
      await queryRunner.commitTransaction();
      return savedInvoice;
    } catch (err: any) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error emitiendo factura directa: ${err.message}`, err.stack);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Liquida y timbra directamente una factura PENDING_PAYMENT desde /dashboard/facturas
   * sin requerir redirigir al cajero/POS.
   */
  async settlePendingInvoice(
    invoiceId: string,
    dto: {
      ncfType?: 'E31' | 'E32' | 'B01' | 'B02';
      paymentMethod?: string;
      userId?: string;
    },
  ): Promise<InvoiceEntity> {
    const invoice = await this.findById(invoiceId);
    if (!isOpenInvoiceStatus(invoice.status)) {
      throw new ConflictException(`La factura ya no está pendiente de pago (estado: ${invoice.status})`);
    }

    const ncfType = dto.ncfType || (invoice.ncfType?.startsWith('E') ? (invoice.ncfType as any) : 'E32');
    const paymentMethod = this.normalizeSalePaymentMethod(dto.paymentMethod);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const saleRepo = queryRunner.manager.getRepository(SaleEntity);
      const detailRepo = queryRunner.manager.getRepository(SaleDetailEntity);

      const subtotal = Number(invoice.subtotal || 0);
      const itbisTotal = Number(invoice.itbisTotal || 0);
      const grandTotal = Number(invoice.grandTotal || (subtotal + itbisTotal));

      const sale = saleRepo.create({
        clientId: invoice.clientId,
        contractId: invoice.contractId,
        userId: dto.userId || null,
        subtotal,
        itbisTotal,
        grandTotal,
        paymentMethod,
        status: 'PAID',
        paidAt: new Date(),
        notes: `Cobro y timbrado de factura recurrente ${invoice.id}`,
      } as any) as unknown as SaleEntity;
      const savedSale = await saleRepo.save(sale);

      const concept = invoice.concept || (invoice.contract?.plan?.name ? `${invoice.contract.plan.name} - Mensualidad de servicio` : 'Servicio de Internet');
      const detail = detailRepo.create({
        saleId: savedSale.id,
        concept,
        itemType: 'PLAN_SUBSCRIPTION',
        quantity: 1,
        unitPrice: subtotal,
        itbisAmount: itbisTotal,
        subtotal,
      } as any) as unknown as SaleDetailEntity;
      await detailRepo.save(detail);
      savedSale.details = [detail];
      savedSale.client = invoice.client;

      const settled = await this.settleInvoice(invoiceId, savedSale, ncfType, queryRunner);
      await queryRunner.commitTransaction();
      return settled;
    } catch (err: any) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error liquidando factura ${invoiceId}: ${err.message}`, err.stack);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Representación Impresa (RI) en formato A4 conforme a la DGII, generada a
   * partir de los mismos metadatos usados para el ticket térmico de 80mm.
   */
  async generateInvoicePdf(invoiceId: string): Promise<Buffer> {
    const metadata = (await this.getReceiptMetadata(invoiceId)) as unknown as InvoiceReceiptMetadata;
    return this.pdfGenerator.generateInvoiceA4Pdf(metadata);
  }

  /**
   * PDF térmico de 80mm con el tamaño de página embebido en el documento —
   * ver el comentario en PdfGeneratorService.generateInvoiceThermalPdf para
   * el porqué (el @page CSS del ticket en pantalla no siempre se respeta al
   * imprimir físicamente).
   */
  async generateInvoiceThermalPdf(invoiceId: string): Promise<Buffer> {
    const metadata = (await this.getReceiptMetadata(invoiceId)) as unknown as InvoiceReceiptMetadata;
    return this.pdfGenerator.generateInvoiceThermalPdf(metadata);
  }

  // 1. Reporte Libro de Ventas DGII 607
  async getDGII607Report(startDate: string, endDate: string) {
    const invoices = await this.invoiceRepository.find({
      where: {
        issuedAt: Between(new Date(`${startDate}T00:00:00Z`), new Date(`${endDate}T23:59:59Z`)),
      },
      relations: ['sale', 'sale.client'],
      order: { issuedAt: 'ASC' },
    });

    return invoices.map((inv) => ({
      rncCedula: inv.sale?.client?.docNumber || 'N/A',
      tipoIdentificacion: inv.sale?.client?.docType === 'RNC' ? 1 : 2,
      numeroComprobante: inv.ncfNumber,
      tipoComprobante: inv.ncfType,
      fechaEmision: inv.issuedAt.toISOString().split('T')[0],
      montoFacturado: Number(inv.sale?.subtotal || 0),
      itbisFacturado: Number(inv.sale?.itbisTotal || 0),
      montoTotal: Number(inv.sale?.grandTotal || 0),
      estadoDGII: inv.dgiiStatus,
      seguridad: inv.securityCode,
    }));
  }

  // 2. Reporte Operativo de SLA & Campo
  async getSlaReport(startDate?: string, endDate?: string) {
    let whereCondition = {};
    if (startDate && endDate) {
      whereCondition = {
        createdAt: Between(new Date(`${startDate}T00:00:00Z`), new Date(`${endDate}T23:59:59Z`)),
      };
    }

    const tickets = await this.ticketRepository.find({
      where: whereCondition,
      relations: [
        'client',
        'contract',
        'contract.plan',
        'contract.address',
        'assignedEmployee',
        'assignedEmployee.user',
        'slaPolicy',
      ],
      order: { createdAt: 'DESC' },
    });

    const totalTickets = tickets.length;
    const resolvedTickets = tickets.filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED');
    const openTickets = tickets.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS' || t.status === 'ON_HOLD');

    let compliantTicketsCount = 0;
    let totalResolutionHours = 0;

    resolvedTickets.forEach((t) => {
      if (t.resolvedAt && t.dueDate) {
        if (new Date(t.resolvedAt) <= new Date(t.dueDate)) {
          compliantTicketsCount++;
        }
      } else {
        compliantTicketsCount++;
      }

      if (t.resolvedAt && t.createdAt) {
        const diffMs = new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime();
        totalResolutionHours += Math.max(0.5, diffMs / (1000 * 60 * 60));
      }
    });

    const slaComplianceRate = resolvedTickets.length > 0
      ? Math.round((compliantTicketsCount / resolvedTickets.length) * 100)
      : 100;

    const avgResolutionHours = resolvedTickets.length > 0
      ? Number((totalResolutionHours / resolvedTickets.length).toFixed(1))
      : 0;

    const technicianMap = new Map<string, { username: string; total: number; resolved: number }>();
    tickets.forEach((t) => {
      const techName = t.assignedEmployee?.user?.username || 'Sin Asignar';
      const curr = technicianMap.get(techName) || { username: techName, total: 0, resolved: 0 };
      curr.total++;
      if (t.status === 'RESOLVED' || t.status === 'CLOSED') curr.resolved++;
      technicianMap.set(techName, curr);
    });

    return {
      summary: {
        totalTickets,
        resolvedTickets: resolvedTickets.length,
        openTickets: openTickets.length,
        slaComplianceRate,
        avgResolutionHours,
      },
      technicians: Array.from(technicianMap.values()),
      tickets: tickets.map((t) => ({
        ticketNumber: t.ticketNumber,
        clientName: t.client?.name || 'N/A',
        sector: t.contract?.address?.sector || 'N/A',
        type: t.type,
        priority: t.priority,
        status: t.status,
        technician: t.assignedEmployee?.user?.username || 'Sin Asignar',
        createdAt: t.createdAt ? t.createdAt.toISOString().split('T')[0] : '',
        dueDate: t.dueDate ? t.dueDate.toISOString().split('T')[0] : '',
        resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString().split('T')[0] : '',
        slaStatus: !t.resolvedAt
          ? (t.dueDate && new Date() > new Date(t.dueDate) ? 'VENCIDO' : 'A_TIEMPO')
          : (t.dueDate && new Date(t.resolvedAt) <= new Date(t.dueDate) ? 'CUMPLIDO' : 'FUERA_SLA'),
      })),
    };
  }

  // 3. Reporte de Inventario & Valorización de Hardware
  async getInventoryValuationReport() {
    const products = await this.productRepository.find({
      relations: ['serials', 'category'],
      order: { name: 'ASC' },
    });

    let totalValuationCost = 0;
    let totalValuationSale = 0;
    let totalUnitsInStock = 0;
    let totalAssignedSerials = 0;
    let totalInStockSerials = 0;

    const formattedProducts = products.map((p) => {
      const cost = Number(p.costPrice || 0);
      const price = Number(p.salePrice || 0);
      const stock = Number(p.stockCurrent || 0);
      const minStock = Number(p.stockMinimum || 10);

      const valCost = cost * stock;
      const valSale = price * stock;
      const margin = price > 0 ? Number((((price - cost) / price) * 100).toFixed(1)) : 0;

      totalValuationCost += valCost;
      totalValuationSale += valSale;
      totalUnitsInStock += stock;

      const serials = p.serials || [];
      const assigned = serials.filter((s) => s.status === 'ASSIGNED_TO_CLIENT').length;
      const inStock = serials.filter((s) => s.status === 'AVAILABLE' || s.status === 'RESERVED').length;

      totalAssignedSerials += assigned;
      totalInStockSerials += inStock;

      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category?.name,
        brand: p.brand,
        model: p.model,
        costPrice: cost,
        salePrice: price,
        marginPercentage: margin,
        stockCurrent: stock,
        stockMinimum: minStock,
        totalCostValue: valCost,
        totalSaleValue: valSale,
        isCritical: stock <= minStock,
        assignedSerials: assigned,
        inStockSerials: inStock,
      };
    });

    return {
      summary: {
        totalProductsCount: products.length,
        totalUnitsInStock,
        totalValuationCost,
        totalValuationSale,
        projectedGrossProfit: totalValuationSale - totalValuationCost,
        totalAssignedSerials,
        totalInStockSerials,
      },
      products: formattedProducts,
    };
  }

  // 4. Reporte Comercial & Cartera de Suscriptores (MRR / ARPU / Días de Pago)
  async getSubscribersReport() {
    const contracts = await this.contractRepository.find({
      relations: ['client', 'plan', 'address'],
      order: { createdAt: 'DESC' },
    });

    const activeContracts = contracts.filter((c) => c.status === 'ACTIVE');
    const pendingContracts = contracts.filter((c) => c.status === 'PENDING_INSTALL');
    const suspendedContracts = contracts.filter((c) => c.status === 'SUSPENDED');

    let mrr = 0;
    const planBreakdownMap = new Map<string, { name: string; count: number; monthlyPrice: number; totalRevenue: number }>();

    activeContracts.forEach((c) => {
      const planPrice = Number(c.plan?.monthlyPrice || 0);
      mrr += planPrice;

      const planName = c.plan?.name || 'Plan Estándar';
      const curr = planBreakdownMap.get(planName) || {
        name: planName,
        count: 0,
        monthlyPrice: planPrice,
        totalRevenue: 0,
      };
      curr.count++;
      curr.totalRevenue += planPrice;
      planBreakdownMap.set(planName, curr);
    });

    const arpu = activeContracts.length > 0 ? Number((mrr / activeContracts.length).toFixed(2)) : 0;

    return {
      summary: {
        totalContracts: contracts.length,
        activeSubscribers: activeContracts.length,
        pendingInstallations: pendingContracts.length,
        suspendedSubscribers: suspendedContracts.length,
        mrr,
        arpu,
      },
      plansDistribution: Array.from(planBreakdownMap.values()),
      subscribers: contracts.map((c) => ({
        contractNumber: c.contractNumber,
        clientName: c.client?.name || 'N/A',
        docNumber: c.client?.docNumber || 'N/A',
        planName: c.plan?.name || 'N/A',
        speed: c.plan?.speedMbps ? `${c.plan.speedMbps} Mbps` : 'N/A',
        monthlyFee: Number(c.plan?.monthlyPrice || 0),
        sector: c.address?.sector || 'Zona Central',
        billingDay: c.billingDay || 15,
        status: c.status,
        startDate: c.startDate,
      })),
    };
  }
}
