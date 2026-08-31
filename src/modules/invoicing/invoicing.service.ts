import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner, Between } from 'typeorm';
import { InvoiceEntity } from './entities/invoice.entity';
import { EcfSequenceEntity } from './entities/ecf-sequence.entity';
import { SaleEntity } from '../pos/entities/sale.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { ProductEntity } from '../inventory/entities/product.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { ClientEntity } from '../clients/entities/client.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { PlanEntity } from '../plans/entities/plan.entity';
import { EmitInvoiceDto } from './dto/emit-invoice.dto';
import { GenerateEcfDto } from './dto/generate-ecf.dto';
import { DgiiXmlGeneratorService, EcfItemInput } from './dgii/dgii-xml-generator.service';
import { DgiiClientService } from './dgii/dgii-client.service';
import { DgiiSignerService } from './dgii/dgii-signer.service';

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
  ) {}

  /**
   * Obtiene y reserva atómicamente la siguiente secuencia correlativa para el tipo de comprobante
   */
  async getNextNcfSequence(
    ncfType: 'E31' | 'E32' | 'E33' | 'E34' | 'E44' | 'E45' | 'B01' | 'B02',
    queryRunner?: QueryRunner,
  ): Promise<string> {
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

    return ncfNumber;
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

    // 1. Obtener correlativo autorizado
    const ncfNumber = await this.getNextNcfSequence(dto.ncfType, queryRunner);

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

    // 3. Generar XML e-CF conforme a XSD
    const rawXml = this.xmlGenerator.generateEcfXml({
      ncfType: dto.ncfType,
      eNcf: ncfNumber,
      fechaEmision: new Date(),
      rncComprador: sale.client?.docNumber,
      razonSocialComprador: sale.client?.name || 'Consumidor Final',
      correoComprador: sale.client?.email,
      ncfModificado: dto.ncfModificado,
      codigoModificacion: dto.codigoModificacion,
      razonModificacion: dto.razonModificacion,
      items: ecfItems,
    });

    // 4. Firmar digitalmente y enviar a los servicios web de la DGII
    const sendResult = await this.dgiiClient.submitEcf(
      rawXml,
      ncfNumber,
      Number(sale.grandTotal),
      sale.client?.docNumber,
    );

    // 5. Persistir Factura Electrónica en Base de Datos
    const invoice = invoiceRepo.create({
      saleId: sale.id,
      ncfNumber,
      ncfType: dto.ncfType,
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
      issuedAt: new Date(),
    });

    return invoiceRepo.save(invoice);
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
      relations: ['sale', 'sale.client', 'sale.details', 'sale.user'],
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
        dgiiStatus: invoice.dgiiStatus,
        securityCode: invoice.securityCode,
        qrCodeUrl: invoice.qrCodeContent,
        issuedAt: invoice.issuedAt,
        contingencyMode: invoice.contingencyMode,
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
        })),
      },
    };
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
      relations: ['serials'],
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
        category: p.category,
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
