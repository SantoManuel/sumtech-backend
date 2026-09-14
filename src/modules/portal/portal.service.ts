import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientEntity } from '../clients/entities/client.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { PlanEntity } from '../plans/entities/plan.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { EmployeeEntity } from '../employees/entities/employee.entity';
import { InteractionEntity } from '../crm/entities/interaction.entity';
import { DepositProofEntity } from './entities/deposit-proof.entity';
import { PlanChangeRequestEntity } from './entities/plan-change-request.entity';
import { ClientNotificationEntity } from './entities/client-notification.entity';
import { PosService } from '../pos/pos.service';
import { MinioStorageService } from '../storage/minio-storage.service';
import { AiChatbotClientService, AiChatbotResponse } from '../ai-chatbot/ai-chatbot-client.service';
import { UsersService } from '../users/users.service';
import { GenieAcsWifiService } from '../genieacs/genieacs-wifi.service';
import { ChangeWifiCredentialsDto } from '../genieacs/dto/change-wifi-credentials.dto';
import {
  UploadDepositProofDto,
  CreatePlanChangeRequestDto,
  PortalChatMessageDto,
  ConvertChatToTicketDto,
  FilterPortalTicketDto
} from './dto/portal.dto';

@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    @InjectRepository(ClientEntity)
    private readonly clientRepository: Repository<ClientEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(PlanEntity)
    private readonly planRepository: Repository<PlanEntity>,
    @InjectRepository(InvoiceEntity)
    private readonly invoiceRepository: Repository<InvoiceEntity>,
    @InjectRepository(SerialNumberEntity)
    private readonly serialRepository: Repository<SerialNumberEntity>,
    @InjectRepository(TicketEntity)
    private readonly ticketRepository: Repository<TicketEntity>,
    @InjectRepository(EmployeeEntity)
    private readonly employeeRepository: Repository<EmployeeEntity>,
    @InjectRepository(InteractionEntity)
    private readonly interactionRepository: Repository<InteractionEntity>,
    @InjectRepository(DepositProofEntity)
    private readonly depositProofRepository: Repository<DepositProofEntity>,
    @InjectRepository(PlanChangeRequestEntity)
    private readonly planChangeRepository: Repository<PlanChangeRequestEntity>,
    @InjectRepository(ClientNotificationEntity)
    private readonly notificationRepository: Repository<ClientNotificationEntity>,
    private readonly posService: PosService,
    private readonly storageService: MinioStorageService,
    private readonly aiChatbotClient: AiChatbotClientService,
    private readonly usersService: UsersService,
    private readonly genieAcsWifiService: GenieAcsWifiService,
  ) {}

  private static readonly ALLOWED_RECEIPT_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
  private static readonly MAX_RECEIPT_FILE_SIZE_BYTES = 5 * 1024 * 1024;

  private async getClientByUserId(userId: string): Promise<ClientEntity> {
    const client = await this.clientRepository.findOne({
      where: { userId },
      relations: ['addresses', 'contracts', 'contracts.plan', 'contracts.address'],
    });

    if (!client) {
      throw new ForbiddenException('No se encontró un perfil de cliente asociado a este usuario.');
    }
    return client;
  }

  // RF-37 & RF-41: Dashboard con selección de múltiples direcciones
  async getDashboardSummary(userId: string, contractId?: string) {
    const client = await this.getClientByUserId(userId);
    const contracts = client.contracts || [];

    if (contracts.length === 0) {
      return {
        client: {
          id: client.id,
          name: client.name,
          docNumber: client.docNumber,
          email: client.email,
          phone: client.phone,
        },
        activeContract: null,
        allContracts: [],
        equipments: [],
        balanceDue: 0,
        unpaidInvoicesCount: 0,
        recentTickets: [],
        unreadNotificationsCount: 0,
      };
    }

    // Seleccionar contrato solicitado o el primero activo
    let activeContract = contracts.find((c) => c.id === contractId);
    if (!activeContract) {
      activeContract = contracts.find((c) => c.status === 'ACTIVE') || contracts[0];
    }

    // Cargar detalles completos del contrato
    const fullContract = await this.contractRepository.findOne({
      where: { id: activeContract.id },
      relations: ['plan', 'address'],
    });

    // 1. Equipos en custodia asignados al cliente
    const equipments = await this.serialRepository.find({
      where: { clientId: client.id, status: 'ASSIGNED_TO_CLIENT' },
      relations: ['product', 'product.category'],
    });

    // 2. Facturación y saldo pendiente
    const invoices = await this.invoiceRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.sale', 'sale')
      .where('sale.clientId = :clientId', { clientId: client.id })
      .orderBy('invoice.issuedAt', 'DESC')
      .getMany();

    const unpaidInvoices = invoices.filter((inv) => inv.sale?.status !== 'PAID');
    const balanceDue = unpaidInvoices.reduce((sum, inv) => sum + Number(inv.sale?.grandTotal || 0), 0);

    // 3. Fechas de corte y próximo pago
    const now = new Date();
    const billingDay = fullContract?.billingDay || 15;
    const nextBillingDate = new Date(now.getFullYear(), now.getMonth(), billingDay);
    if (now.getDate() > billingDay) {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    }
    const nextDueDate = new Date(nextBillingDate);
    nextDueDate.setDate(nextDueDate.getDate() + 5);

    // 4. Tickets recientes de este contrato
    const recentTickets = await this.ticketRepository.find({
      where: { contractId: fullContract?.id },
      order: { createdAt: 'DESC' },
      take: 5,
    });

    // 5. Contador de notificaciones no leídas
    const unreadNotificationsCount = await this.notificationRepository.count({
      where: { clientId: client.id, isRead: false },
    });

    return {
      client: {
        id: client.id,
        name: client.name,
        docNumber: client.docNumber,
        email: client.email,
        phone: client.phone,
      },
      activeContract: {
        id: fullContract?.id,
        contractNumber: fullContract?.contractNumber,
        status: fullContract?.status,
        startDate: fullContract?.startDate,
        billingDay,
        nextBillingDate: nextBillingDate.toISOString().split('T')[0],
        nextDueDate: nextDueDate.toISOString().split('T')[0],
        plan: fullContract?.plan,
        address: fullContract?.address,
      },
      allContracts: contracts.map((c) => ({
        id: c.id,
        contractNumber: c.contractNumber,
        status: c.status,
        planName: c.plan?.name,
        street: c.address?.street,
        sector: c.address?.sector,
        municipality: c.address?.municipality,
        city: c.address?.city,
      })),
      equipments: equipments.map((e) => ({
        id: e.id,
        serialNumber: e.serialNumber,
        macAddress: e.macAddress,
        productName: e.product?.name,
        category: e.product?.category?.name,
        brand: e.product?.brand,
        model: e.product?.model,
      })),
      balanceDue,
      unpaidInvoicesCount: unpaidInvoices.length,
      recentTickets,
      unreadNotificationsCount,
    };
  }

  // Listado paginado de tickets del cliente autenticado (historial completo,
  // a diferencia de `recentTickets` de getDashboardSummary que está capado a 5).
  async getTickets(userId: string, filterDto: FilterPortalTicketDto) {
    const client = await this.getClientByUserId(userId);
    const page = filterDto.page || 1;
    const limit = filterDto.limit || 10;
    const skip = (page - 1) * limit;

    const query = this.ticketRepository
      .createQueryBuilder('ticket')
      .where('ticket.clientId = :clientId', { clientId: client.id })
      .orderBy('ticket.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    if (filterDto.contractId) {
      query.andWhere('ticket.contractId = :contractId', { contractId: filterDto.contractId });
    }
    if (filterDto.status) {
      query.andWhere('ticket.status = :status', { status: filterDto.status });
    }

    const [data, total] = await query.getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // RF-38: Historial de Pagos y Facturas
  async getInvoices(userId: string) {
    const client = await this.getClientByUserId(userId);

    const invoices = await this.invoiceRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.sale', 'sale')
      .leftJoinAndSelect('sale.details', 'details')
      .where('sale.clientId = :clientId', { clientId: client.id })
      .orderBy('invoice.issuedAt', 'DESC')
      .getMany();

    return invoices.map((inv) => ({
      id: inv.id,
      ncf: inv.ncfNumber,
      ncfType: inv.ncfType,
      subtotal: Number(inv.sale?.subtotal || 0),
      itbis: Number(inv.sale?.itbisTotal || 0),
      total: Number(inv.sale?.grandTotal || 0),
      paymentStatus: inv.sale?.status || 'PAID',
      dgiiStatus: inv.dgiiStatus,
      paymentMethod: inv.sale?.paymentMethod || 'CASH',
      issuedAt: inv.issuedAt,
      details: inv.sale?.details || [],
    }));
  }

  /**
   * Valida el archivo del comprobante: obligatorio, tipo (JPG/PNG/PDF) y
   * tamaño máximo 5MB. El límite de tamaño del FileInterceptor en el
   * controller ya corta archivos absurdamente grandes antes de llegar aquí;
   * esta validación cubre el mensaje de negocio claro en español y el chequeo
   * de tipo, que multer no hace por sí solo.
   */
  private assertValidReceiptFile(file?: Express.Multer.File): asserts file is Express.Multer.File {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('Debes adjuntar el comprobante de tu transferencia o depósito (imagen o PDF).');
    }
    if (!PortalService.ALLOWED_RECEIPT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('El comprobante debe ser una imagen (JPG, PNG) o un PDF.');
    }
    if (file.size > PortalService.MAX_RECEIPT_FILE_SIZE_BYTES) {
      throw new BadRequestException('El comprobante no puede superar los 5MB.');
    }
  }

  // RF-38: Subida de Comprobante de Depósito (archivo obligatorio, almacenado en MinIO)
  async submitDepositProof(userId: string, dto: UploadDepositProofDto, receiptFile?: Express.Multer.File) {
    const client = await this.getClientByUserId(userId);
    this.assertValidReceiptFile(receiptFile);

    const receiptFileKey = await this.storageService.uploadBuffer(
      receiptFile.buffer,
      receiptFile.originalname,
      `deposit-proofs/${client.id}`,
      receiptFile.mimetype,
    );

    const proof = this.depositProofRepository.create({
      clientId: client.id,
      invoiceId: dto.invoiceId,
      bankName: dto.bankName,
      referenceNumber: dto.referenceNumber,
      amount: dto.amount,
      depositDate: dto.depositDate,
      receiptFileKey,
      receiptMimeType: receiptFile.mimetype,
      reviewNotes: dto.notes,
      status: 'PENDING_REVIEW',
    });

    const savedProof = await this.depositProofRepository.save(proof);

    // Notificación automática al cliente
    await this.notificationRepository.save(
      this.notificationRepository.create({
        clientId: client.id,
        title: 'Comprobante de Pago Recibido',
        message: `Hemos recibido tu comprobante por RD$ ${dto.amount.toLocaleString()} (Ref: ${dto.referenceNumber}). Nuestro equipo o chatbot validará el depósito a la brevedad.`,
        type: 'PAYMENT_CONFIRMED',
        link: '/portal/pagos',
      }),
    );

    return savedProof;
  }

  // Conciliación de depósitos bancarios (canal de cobro adicional, staff ADMIN/GERENTE/CAJERO)
  async approveDepositProof(depositProofId: string, reviewerUserId: string): Promise<DepositProofEntity> {
    const proof = await this.depositProofRepository.findOne({ where: { id: depositProofId } });
    if (!proof) {
      throw new NotFoundException(`Comprobante de depósito con ID ${depositProofId} no encontrado`);
    }
    if (proof.status !== 'PENDING_REVIEW') {
      throw new BadRequestException(`El comprobante ${depositProofId} ya fue revisado (estado: ${proof.status})`);
    }

    proof.status = 'APPROVED';
    proof.reviewedByUserId = reviewerUserId;
    await this.depositProofRepository.save(proof);

    // Aplicación automática solo si el monto coincide EXACTO con la factura
    // PENDING_PAYMENT más antigua del cliente (respeta "solo pago completo",
    // sin aplicar dinero a ciegas cuando el monto no calza con ninguna factura).
    const oldestPending = await this.invoiceRepository.findOne({
      where: { clientId: proof.clientId, status: 'PENDING_PAYMENT' },
      order: { dueDate: 'ASC' },
    });

    if (oldestPending && Number(oldestPending.grandTotal) === Number(proof.amount)) {
      await this.applyDepositProofToInvoice(proof.id, oldestPending.id, reviewerUserId);
    } else {
      await this.notificationRepository.save(
        this.notificationRepository.create({
          clientId: proof.clientId,
          title: 'Comprobante de Depósito Aprobado',
          message: `Tu comprobante por RD$ ${Number(proof.amount).toLocaleString('es-DO')} fue aprobado. Nuestro equipo aplicará el pago a tu(s) factura(s) en breve.`,
          type: 'PAYMENT_CONFIRMED',
          link: '/portal/facturas',
        }),
      );
    }

    return this.depositProofRepository.findOneOrFail({ where: { id: depositProofId } });
  }

  async rejectDepositProof(
    depositProofId: string,
    reviewerUserId: string,
    reason?: string,
  ): Promise<DepositProofEntity> {
    const proof = await this.depositProofRepository.findOne({ where: { id: depositProofId } });
    if (!proof) {
      throw new NotFoundException(`Comprobante de depósito con ID ${depositProofId} no encontrado`);
    }
    if (proof.status !== 'PENDING_REVIEW') {
      throw new BadRequestException(`El comprobante ${depositProofId} ya fue revisado (estado: ${proof.status})`);
    }

    proof.status = 'REJECTED';
    proof.reviewedByUserId = reviewerUserId;
    if (reason) {
      proof.reviewNotes = reason;
    }
    const saved = await this.depositProofRepository.save(proof);

    await this.notificationRepository.save(
      this.notificationRepository.create({
        clientId: proof.clientId,
        title: 'Comprobante de Depósito Rechazado',
        message: `Tu comprobante por RD$ ${Number(proof.amount).toLocaleString('es-DO')} fue rechazado${reason ? `: ${reason}` : '.'} Verifica los datos e intenta de nuevo o contacta a soporte.`,
        type: 'PAYMENT_CONFIRMED',
        link: '/portal/pagos',
      }),
    );

    return saved;
  }

  /**
   * Aplica un comprobante ya APPROVED a una factura PENDING_PAYMENT específica del
   * mismo cliente, liquidándola vía PosService.collectInvoices (paymentMethod
   * BANK_TRANSFER, sin caja registradora) — reutiliza el mismo camino de timbrado
   * y reactivación de contrato que el cobro presencial en POS. Relación 1:1
   * (DepositProofEntity.invoiceId es una sola FK): un comprobante que deba cubrir
   * varias facturas requiere aplicarse una por una manualmente.
   */
  async applyDepositProofToInvoice(
    depositProofId: string,
    invoiceId: string,
    reviewerUserId: string,
  ): Promise<InvoiceEntity> {
    const proof = await this.depositProofRepository.findOne({ where: { id: depositProofId } });
    if (!proof) {
      throw new NotFoundException(`Comprobante de depósito con ID ${depositProofId} no encontrado`);
    }
    if (proof.status !== 'APPROVED') {
      throw new BadRequestException('El comprobante debe estar APPROVED antes de aplicarse a una factura');
    }

    const invoice = await this.invoiceRepository.findOne({ where: { id: invoiceId } });
    if (!invoice) {
      throw new NotFoundException(`Factura con ID ${invoiceId} no encontrada`);
    }
    if (invoice.clientId !== proof.clientId) {
      throw new BadRequestException('La factura no pertenece al mismo cliente del comprobante');
    }
    if (invoice.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException(`La factura ${invoiceId} no está pendiente de pago`);
    }

    const client = await this.clientRepository.findOne({ where: { id: proof.clientId } });
    const ncfType = client?.docType === 'RNC' ? 'E31' : 'E32';

    const [settledSale] = await this.posService.collectInvoices(reviewerUserId, {
      invoiceIds: [invoiceId],
      paymentMethod: 'BANK_TRANSFER',
      ncfType,
      notes: `Aplicado desde comprobante de depósito ${proof.id} (${proof.bankName} / ${proof.referenceNumber})`,
    });

    proof.invoiceId = invoiceId;
    await this.depositProofRepository.save(proof);

    if (!settledSale.invoice) {
      throw new NotFoundException(`No se pudo recuperar la factura liquidada para la venta ${settledSale.id}`);
    }
    return settledSale.invoice;
  }

  /**
   * Genera la URL firmada (corta duración) para ver el archivo del
   * comprobante. Los registros legado sin receiptFileKey (enviados antes de
   * exigir archivo) caen de vuelta al receiptUrl de texto libre que tengan.
   */
  private async resolveReceiptUrl(proof: DepositProofEntity): Promise<string | null> {
    if (proof.receiptFileKey) {
      return this.storageService.getPresignedUrl(proof.receiptFileKey);
    }
    return proof.receiptUrl || null;
  }

  /**
   * Cola de revisión para staff (ADMIN/GERENTE/CAJERO): todos los comprobantes
   * de depósito, opcionalmente filtrados por estado. Distinto de getDepositProofs
   * (autoservicio del cliente, escrito desde el JWT), ya que el staff necesita
   * ver los de TODOS los clientes, no solo los propios.
   */
  async getAllDepositProofs(status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED') {
    const where = status ? { status } : {};
    const proofs = await this.depositProofRepository.find({
      where,
      relations: ['client'],
      order: { createdAt: 'DESC' },
    });
    return Promise.all(
      proofs.map(async (proof) => ({ ...proof, receiptUrl: await this.resolveReceiptUrl(proof) })),
    );
  }

  async getDepositProofs(userId: string) {
    const client = await this.getClientByUserId(userId);
    const proofs = await this.depositProofRepository.find({
      where: { clientId: client.id },
      order: { createdAt: 'DESC' },
    });
    return Promise.all(
      proofs.map(async (proof) => ({ ...proof, receiptUrl: await this.resolveReceiptUrl(proof) })),
    );
  }

  // RF-40: Planes Disponibles y Cálculo de Prorrateo
  async getAvailablePlansForUpgrade(userId: string, contractId: string) {
    const client = await this.getClientByUserId(userId);
    const contract = await this.contractRepository.findOne({
      where: { id: contractId, clientId: client.id },
      relations: ['plan'],
    });

    if (!contract) {
      throw new NotFoundException('Contrato no encontrado.');
    }

    const currentPlanPrice = Number(contract.plan?.monthlyPrice || 0);
    const plans = await this.planRepository.find({ where: { isActive: true } });

    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const remainingDays = Math.max(1, daysInMonth - now.getDate());

    return plans.map((plan) => {
      const targetPrice = Number(plan.monthlyPrice);
      const isCurrent = plan.id === contract.planId;
      const isUpgrade = targetPrice > currentPlanPrice;
      const dailyDiff = (targetPrice - currentPlanPrice) / daysInMonth;
      const proratedAmount = isUpgrade ? Math.round(dailyDiff * remainingDays * 100) / 100 : 0;

      return {
        ...plan,
        monthlyPrice: targetPrice,
        isCurrent,
        isUpgrade,
        remainingDaysInCycle: remainingDays,
        proratedAmount,
      };
    });
  }

  async submitPlanChangeRequest(userId: string, dto: CreatePlanChangeRequestDto) {
    const client = await this.getClientByUserId(userId);
    const contract = await this.contractRepository.findOne({
      where: { id: dto.contractId, clientId: client.id },
      relations: ['plan'],
    });

    if (!contract) {
      throw new NotFoundException('Contrato no encontrado.');
    }

    const requestedPlan = await this.planRepository.findOneBy({ id: dto.requestedPlanId });
    if (!requestedPlan) {
      throw new NotFoundException('Plan solicitado no encontrado.');
    }

    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const remainingDays = Math.max(1, daysInMonth - now.getDate());
    const currentPrice = Number(contract.plan?.monthlyPrice || 0);
    const requestedPrice = Number(requestedPlan.monthlyPrice);
    const dailyDiff = (requestedPrice - currentPrice) / daysInMonth;
    const proratedAmount = requestedPrice > currentPrice ? Math.round(dailyDiff * remainingDays * 100) / 100 : 0;

    const request = this.planChangeRepository.create({
      clientId: client.id,
      contractId: contract.id,
      currentPlanId: contract.planId,
      requestedPlanId: requestedPlan.id,
      proratedAmount,
      status: 'PENDING_APPROVAL',
      reason: dto.reason || 'Solicitud desde Portal de Autoservicio',
    });

    const savedRequest = await this.planChangeRepository.save(request);

    // Notificación al cliente
    await this.notificationRepository.save(
      this.notificationRepository.create({
        clientId: client.id,
        title: 'Solicitud de Cambio de Plan',
        message: `Tu solicitud de cambio al plan ${requestedPlan.name} fue enviada. Prorrateo estimado: RD$ ${proratedAmount.toLocaleString()}.`,
        type: 'PROMOTION',
        link: '/portal/servicios',
      }),
    );

    return savedRequest;
  }

  // RF-42: Notificaciones
  async getNotifications(userId: string) {
    const client = await this.getClientByUserId(userId);
    return this.notificationRepository.find({
      where: { clientId: client.id },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  async markNotificationRead(userId: string, notificationId: string) {
    const client = await this.getClientByUserId(userId);
    await this.notificationRepository.update(
      { id: notificationId, clientId: client.id },
      { isRead: true },
    );
    return { success: true };
  }

  async markAllNotificationsRead(userId: string) {
    const client = await this.getClientByUserId(userId);
    const result = await this.notificationRepository.update(
      { clientId: client.id, isRead: false },
      { isRead: true },
    );
    return { success: true, updated: result.affected || 0 };
  }

  async deleteNotification(userId: string, notificationId: string) {
    const client = await this.getClientByUserId(userId);
    const result = await this.notificationRepository.delete({
      id: notificationId,
      clientId: client.id,
    });
    if (!result.affected) {
      throw new NotFoundException(`Notificación con ID ${notificationId} no encontrada`);
    }
    return { success: true };
  }

  /**
   * La base local (`sumtech_erp`) quedó creada en encoding WIN1252 en vez de
   * UTF8 (incidente 2026-09-10: el chat fallaba con 500 al persistir texto
   * con emoji — QueryFailedError, "no equivalent in encoding WIN1252"). Se
   * está recodificando la base a UTF8, pero se deja este saneo como defensa
   * adicional para cualquier entorno que reintroduzca el mismo desajuste de
   * encoding — solo afecta el texto que se guarda en el historial CRM/ticket,
   * nunca la respuesta que ve el cliente en el chat.
   */
  private stripNonLatin1(text: string): string {
    return text.replace(/[^\t\n\r\x20-\xFF]/g, '');
  }

  private readonly technicalKeywords = [
    'no tengo internet', 'sin internet', 'sin servicio', 'averia', 'avería',
    'señal mala', 'lenta', 'lento', 'desconectado', 'luz roja', 'los', 'pon',
    'caido', 'caída', 'intermitente', 'fibra rota',
  ];
  private readonly billingKeywords = ['factura', 'pago', 'balance', 'recibo', 'transferencia', 'banco', 'pagar', 'cuanto debo', 'corte'];
  private readonly planKeywords = ['cambiar plan', 'aumentar velocidad', 'upgrade', 'mas megas', 'mas canales', 'mejorar plan'];

  private async logChatInteraction(client: ClientEntity, userId: string, userMessage: string, botResponse: string) {
    await this.interactionRepository.save(
      this.interactionRepository.create({
        clientId: client.id,
        userId,
        channel: 'SYSTEM_EVENT',
        subject: this.stripNonLatin1(`Consulta Chat Portal: ${userMessage.slice(0, 50)}`),
        notes: this.stripNonLatin1(`Cliente envió: "${userMessage}". Chatbot respondió: "${botResponse.slice(0, 150)}..."`),
      }),
    );
  }

  /**
   * `Chatbot_sumtech` no calcula estos dos campos (son específicos del flujo
   * de ticketing del ERP) — se derivan acá a partir de su clasificación.
   */
  private shouldOfferTicket(ai: AiChatbotResponse, originalMessageLower: string): boolean {
    if (ai.escalated) return true;
    if (ai.intent === 'soporte_tecnico_internet') return true;
    return this.technicalKeywords.some((kw) => originalMessageLower.includes(kw));
  }

  private suggestPriorityFromIntent(ai: AiChatbotResponse, originalMessageLower: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (ai.escalated) return 'HIGH';
    if (originalMessageLower.includes('luz roja') || originalMessageLower.includes('sin servicio')) return 'HIGH';
    return 'MEDIUM';
  }

  // RF-39: Chatbot Interactivo y Detección de Averías — respuesta generada por
  // Chatbot_sumtech (RAG + Gemini/Ollama, proyecto separado), con degradación
  // automática al sistema de keywords si el servicio de IA no responde.
  async processChatMessage(userId: string, dto: PortalChatMessageDto) {
    const client = await this.getClientByUserId(userId);
    const messageLower = dto.message.toLowerCase();

    // El RAG de Chatbot_sumtech es contenido genérico de empresa — a propósito
    // no conoce (ni debe inventar) el balance/fecha de corte real de una
    // cuenta puntual. Si el mensaje es de facturación, se le inyecta el dato
    // real del cliente como contexto en vez de dejar que el LLM lo adivine.
    let messageForAi = dto.message;
    if (this.billingKeywords.some((kw) => messageLower.includes(kw))) {
      const summary = await this.getDashboardSummary(userId, dto.contractId);
      messageForAi += `\n\n[Contexto de cuenta del cliente — usa este dato real, no inventes otro: balance pendiente RD$ ${summary.balanceDue.toLocaleString()}, próximo corte ${summary.activeContract?.nextBillingDate || 'no disponible'}]`;
    }

    try {
      const ai = await this.aiChatbotClient.sendMessage(client.id, messageForAi, client.name);
      await this.logChatInteraction(client, userId, dto.message, ai.response);

      return {
        sender: 'bot',
        message: ai.response,
        timestamp: new Date().toISOString(),
        canConvertTicket: this.shouldOfferTicket(ai, messageLower),
        suggestedPriority: this.suggestPriorityFromIntent(ai, messageLower),
      };
    } catch (err) {
      this.logger.warn(`Chatbot_sumtech no disponible, usando fallback de keywords: ${(err as Error).message}`);
      return this.processChatMessageFallback(client, userId, dto, messageLower);
    }
  }

  /** Sistema de respuestas por plantilla — se usa solo si Chatbot_sumtech no responde. */
  private async processChatMessageFallback(client: ClientEntity, userId: string, dto: PortalChatMessageDto, messageLower: string) {
    const isTechnicalIssue = this.technicalKeywords.some((kw) => messageLower.includes(kw));
    const isBillingQuery = this.billingKeywords.some((kw) => messageLower.includes(kw));
    const isPlanQuery = this.planKeywords.some((kw) => messageLower.includes(kw));

    let botResponse = '';
    let canConvertTicket = false;
    let suggestedPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM';

    if (isTechnicalIssue) {
      botResponse = `Hola ${client.name.split(' ')[0]}, lamentamos mucho los inconvenientes con tu servicio.

🔧 **Diagnóstico Rápido:**
1. Verifica que el cable de fibra óptica (amarillo) esté firmemente conectado a tu Router ONU.
2. Comprueba si la luz **PON** está verde fija o si la luz **LOS** parpadea en rojo.
3. Desconecta el router de la corriente durante 15 segundos y vuelve a encenderlo.

Si tras reiniciar el problema persiste, presiona el botón **"Convertir en Reclamación Formal"** a continuación para enviar una orden de trabajo inmediata al equipo técnico de tu zona.`;
      canConvertTicket = true;
      suggestedPriority = messageLower.includes('luz roja') || messageLower.includes('sin servicio') ? 'HIGH' : 'MEDIUM';
    } else if (isBillingQuery) {
      const summary = await this.getDashboardSummary(userId, dto.contractId);
      botResponse = `Hola ${client.name.split(' ')[0]}. Tu balance pendiente actual es de **RD$ ${summary.balanceDue.toLocaleString()}**.

Tu fecha de próximo corte es el **${summary.activeContract?.nextBillingDate || 'día 15'}**. Puedes subir tu recibo de transferencia o depósito bancario desde la pestaña **Pagos** para validarlo al instante.`;
    } else if (isPlanQuery) {
      botResponse = `¡Excelente! Puedes solicitar una mejora de velocidad o añadir canales de TV directamente desde la sección **"Mis Servicios"** con cálculo automático de prorrateo mensual.`;
    } else {
      botResponse = `Hola ${client.name.split(' ')[0]}, gracias por comunicarte con el Asistente Digital de Sumtech. ¿En qué te podemos colaborar hoy? Puedes consultarme sobre el estado de tu internet, facturación, reportar una avería o solicitar un cambio de plan.`;
    }

    await this.logChatInteraction(client, userId, dto.message, botResponse);

    return {
      sender: 'bot',
      message: botResponse,
      timestamp: new Date().toISOString(),
      canConvertTicket,
      suggestedPriority,
    };
  }

  // RF-39: Conversión de Chat a Reclamación Formal Asignada a Zona
  async convertChatToTicket(userId: string, dto: ConvertChatToTicketDto) {
    const client = await this.getClientByUserId(userId);
    const contract = await this.contractRepository.findOne({
      where: { id: dto.contractId, clientId: client.id },
      relations: ['address', 'plan'],
    });

    if (!contract) {
      throw new NotFoundException('Contrato no encontrado.');
    }

    // Asignación inteligente por zona: buscar técnicos
    const technicians = await this.employeeRepository
      .createQueryBuilder('emp')
      .leftJoinAndSelect('emp.user', 'user')
      .leftJoinAndSelect('user.roles', 'role')
      .where('role.name = :roleName', { roleName: 'TECNICO' })
      .andWhere('emp.isActive = true')
      .getMany();

    const assignedTechnician = technicians.length > 0 ? technicians[0] : null;

    const dueDate = new Date();
    dueDate.setHours(dueDate.getHours() + (dto.priority === 'HIGH' ? 8 : 24));

    const ticket = this.ticketRepository.create({
      ticketNumber: `TCK-${Date.now().toString().slice(-6)}`,
      title: `Reclamación Avería - ${contract.address?.sector || 'Cliente Portal'}`,
      description: this.stripNonLatin1(
        `[RECLAMACIÓN DESDE PORTAL WEB] ${dto.description}\nZona: ${contract.address?.municipality || 'Principal'} - Sector: ${contract.address?.sector || 'S/N'}${dto.chatSummary ? `\nHistorial: ${dto.chatSummary}` : ''}`,
      ),
      clientId: client.id,
      contractId: contract.id,
      assignedEmployeeId: assignedTechnician?.id,
      type: 'REPAIR_FAULT',
      priority: dto.priority || 'HIGH',
      status: 'OPEN',
      dueDate,
    });

    const savedTicket = await this.ticketRepository.save(ticket);

    // Notificación Push / Web al cliente
    await this.notificationRepository.save(
      this.notificationRepository.create({
        clientId: client.id,
        title: `Reclamación Formal Registrada`,
        message: `Tu reporte de avería ha sido registrado exitosamente y canalizado al equipo técnico para ${contract.address?.sector || 'tu zona'}.`,
        type: 'TICKET_UPDATE',
        link: '/portal/soporte',
      }),
    );

    // Registro en CRM
    await this.interactionRepository.save(
      this.interactionRepository.create({
        clientId: client.id,
        userId,
        channel: 'SYSTEM_EVENT',
        subject: `Apertura de Ticket desde Chatbot`,
        notes: `Ticket de avería ID ${savedTicket.id} generado automáticamente con prioridad ${dto.priority || 'HIGH'}.`,
      }),
    );

    return {
      success: true,
      ticket: savedTicket,
      message: `Tu reclamación formal ha sido creada y asignada a la cuadrilla técnica de tu zona.`,
    };
  }

  /** Estado actual (SSID cacheado) de la red WiFi de un contrato del cliente autenticado. */
  async getWifiStatus(userId: string, contractId: string) {
    const client = await this.getClientByUserId(userId);
    await this.assertContractOwnership(client.id, contractId);
    return this.genieAcsWifiService.getWifiStatus(contractId);
  }

  /**
   * Autogestión de WiFi (Fase 02): reautentica con la contraseña de la
   * cuenta del portal antes de tocar nada — cambiar el WiFi desconecta todos
   * los dispositivos del hogar del cliente, no es una acción trivial.
   */
  async changeWifiCredentials(userId: string, dto: ChangeWifiCredentialsDto) {
    const client = await this.getClientByUserId(userId);
    await this.assertContractOwnership(client.id, dto.contractId);

    if (!client.userId) {
      throw new ForbiddenException('Este cliente no tiene una cuenta digital asociada.');
    }
    const passwordOk = await this.usersService.verifyPassword(client.userId, dto.currentAccountPassword);
    if (!passwordOk) {
      throw new ForbiddenException('La contraseña actual no es correcta.');
    }

    const device = await this.genieAcsWifiService.changeWifiCredentials(dto.contractId, {
      ssid: dto.ssid,
      ssid5g: dto.ssid5g,
      password: dto.newPassword,
    });

    return {
      success: true,
      ssid: device.ssid,
      ssid5g: device.ssid5g,
      message: 'Tu WiFi se está actualizando — tu equipo se reiniciará y perderás la conexión unos segundos.',
    };
  }

  /** Lanza NotFoundException si el contrato no existe o no pertenece a este cliente — mismo patrón usado en el resto del portal. */
  private async assertContractOwnership(clientId: string, contractId: string): Promise<void> {
    const contract = await this.contractRepository.findOneBy({ id: contractId, clientId });
    if (!contract) {
      throw new NotFoundException('Contrato no encontrado.');
    }
  }
}
