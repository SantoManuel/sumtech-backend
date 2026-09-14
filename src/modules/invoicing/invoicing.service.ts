import { Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner, DataSource, Between } from 'typeorm';
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
import { DgiiXmlGeneratorService, EcfItemInput, UNIDAD_MEDIDA_UND, usesNcfExpiryDate } from './dgii/dgii-xml-generator.service';
import { DgiiClientService } from './dgii/dgii-client.service';
import { DgiiSignerService } from './dgii/dgii-signer.service';
import { PdfGeneratorService } from '../printing/pdf-generator.service';
import { InvoiceReceiptMetadata } from '../printing/pdf-generator.types';

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
    private readonly dataSource: DataSource,
  ) {}

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

    // Formatear a 8 dígitos para e-CF (o 8 dígitos para B01/B02)
    const formattedSeq = currentSeqNum.toString().padStart(8, '0');
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

    // 3. Generar XML e-CF conforme a XSD
    const rawXml = this.xmlGenerator.generateEcfXml({
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
    });

    // 4. Firmar digitalmente y enviar a los servicios web de la DGII
    const sendResult = await this.dgiiClient.submitEcf(
      rawXml,
      ncfNumber,
      Number(sale.grandTotal),
      sale.client?.docNumber,
    );

    return {
      ncfNumber,
      ncfType,
      // Vencimiento de la secuencia de NCF autorizada al momento del timbrado —
      // no confundir con la fecha de cobro de la factura (sale.dueDate). Solo
      // aplica a comprobantes con crédito fiscal (no E32/E34).
      ncfExpiryDate: usesNcfExpiryDate(ncfType) ? sequenceExpiryDate : undefined,
      dgiiStatus: sendResult.status,
      dgiiTrackId: sendResult.trackId,
      securityCode: sendResult.securityCode,
      qrCodeContent: sendResult.qrCodeUrl,
      signedXmlContent: sendResult.signedXml,
      responseMessage: sendResult.responseMessage,
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

    const invoice = await invoiceRepo.findOne({ where: { id: invoiceId } });
    if (!invoice) {
      throw new NotFoundException(`Factura con ID ${invoiceId} no encontrada`);
    }
    if (invoice.status !== 'PENDING_PAYMENT') {
      throw new ConflictException(
        `La factura ${invoiceId} no está pendiente de pago (estado actual: ${invoice.status})`,
      );
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
    if (invoice.status !== 'PENDING_PAYMENT') {
      throw new ConflictException(
        `Solo se pueden anular facturas PENDING_PAYMENT (estado actual: ${invoice.status}). Una factura ISSUED requiere una Nota de Crédito.`,
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
      if (hoursSinceIssued > 48) {
        throw new ConflictException(
          'Esta factura tiene más de 48 horas desde su emisión — solo un ADMIN o GERENTE puede anularla.',
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

  async findAll(dto: {
    page?: number;
    limit?: number;
    status?: string;
    clientId?: string;
    search?: string;
    dueDateFrom?: string;
    dueDateTo?: string;
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
      .orderBy(`invoice.${dto.sortBy || 'issuedAt'}`, dto.sortDir || 'DESC')
      .skip(skip)
      .take(limit);

    if (dto.status) {
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
  async getReceiptMetadata(invoiceId: string) {
    const invoice = await this.findById(invoiceId);
    if (!invoice.sale) {
      throw new BadRequestException(
        `La factura ${invoiceId} está pendiente de pago y aún no tiene una venta asociada`,
      );
    }
    const sale = invoice.sale;
    const config = this.dgiiClient.getConfig();

    return {
      company: {
        rnc: config.rncEmisor,
        razonSocial: config.razonSocialEmisor,
        nombreComercial: config.nombreComercial,
        direccion: config.direccionEmisor,
        telefono: config.telefonoEmisor,
        correo: config.correoEmisor,
      },
      invoice: {
        id: invoice.id,
        ncfNumber: invoice.ncfNumber,
        ncfType: invoice.ncfType,
        // Vencimiento de la secuencia de NCF (no la fecha de cobro de la factura,
        // ver ncfExpiryDate en InvoicingService.buildEcfPayload). Solo presente
        // para comprobantes con crédito fiscal (no E32/E34).
        ncfExpiryDate: invoice.ncfExpiryDate,
        dgiiStatus: invoice.dgiiStatus,
        securityCode: invoice.securityCode,
        qrCodeUrl: invoice.qrCodeContent,
        issuedAt: invoice.issuedAt,
        contingencyMode: invoice.contingencyMode,
        ncfModificado: invoice.ncfModificado,
        razonModificacion: invoice.razonModificacion,
      },
      client: {
        name: sale.client?.name || 'Consumidor Final',
        docNumber: sale.client?.docNumber || 'N/A',
        docType: sale.client?.docType || 'CEDULA',
        email: sale.client?.email || 'N/A',
      },
      sale: {
        id: sale.id,
        paymentMethod: sale.paymentMethod,
        billingPeriod: sale.billingPeriod || 'Mes Actual',
        dueDate: sale.dueDate || 'N/A',
        subtotal: Number(sale.subtotal),
        discountAmount: Number(sale.discountAmount),
        itbisTotal: Number(sale.itbisTotal),
        grandTotal: Number(sale.grandTotal),
        cashier: sale.user?.username || 'Cajero Sumtech',
        details: sale.details.map((d) => ({
          concept: d.concept,
          quantity: d.quantity,
          unitPrice: Number(d.unitPrice),
          itbisAmount: Number(d.itbisAmount),
          subtotal: Number(d.subtotal),
          // No existe un código DGII dedicado a "servicio" (ver UNIDAD_MEDIDA_UND);
          // para la impresión se etiqueta como unidad de negocio, no el código XML.
          unidadMedida: d.itemType === 'PRODUCT_HARDWARE' ? 'UND' : 'SERV',
        })),
      },
    };
  }

  /**
   * Representación Impresa (RI) en formato A4 conforme a la DGII, generada a
   * partir de los mismos metadatos usados para el ticket térmico de 80mm.
   */
  async generateInvoicePdf(invoiceId: string): Promise<Buffer> {
    const metadata = (await this.getReceiptMetadata(invoiceId)) as unknown as InvoiceReceiptMetadata;
    return this.pdfGenerator.generateInvoiceA4Pdf(metadata);
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
