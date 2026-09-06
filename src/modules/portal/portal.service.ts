import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
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
import { 
  UploadDepositProofDto, 
  CreatePlanChangeRequestDto, 
  PortalChatMessageDto, 
  ConvertChatToTicketDto 
} from './dto/portal.dto';

@Injectable()
export class PortalService {
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
  ) {}

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

  // RF-38: Subida de Comprobante de Depósito
  async submitDepositProof(userId: string, dto: UploadDepositProofDto) {
    const client = await this.getClientByUserId(userId);

    const proof = this.depositProofRepository.create({
      clientId: client.id,
      invoiceId: dto.invoiceId,
      bankName: dto.bankName,
      referenceNumber: dto.referenceNumber,
      amount: dto.amount,
      depositDate: dto.depositDate,
      receiptUrl: dto.receiptUrl || 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&q=80&w=600',
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

  async getDepositProofs(userId: string) {
    const client = await this.getClientByUserId(userId);
    return this.depositProofRepository.find({
      where: { clientId: client.id },
      order: { createdAt: 'DESC' },
    });
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

  // RF-39: Chatbot Interactivo y Detección de Averías
  async processChatMessage(userId: string, dto: PortalChatMessageDto) {
    const client = await this.getClientByUserId(userId);
    const messageLower = dto.message.toLowerCase();

    // 1. Detección de Averías e Incidencias Técnicas
    const technicalKeywords = [
      'no tengo internet', 'sin internet', 'sin servicio', 'averia', 'avería', 
      'señal mala', 'lenta', 'lento', 'desconectado', 'luz roja', 'los', 'pon', 
      'caido', 'caída', 'intermitente', 'fibra rota'
    ];
    const isTechnicalIssue = technicalKeywords.some((kw) => messageLower.includes(kw));

    // 2. Detección de Facturación y Pagos
    const billingKeywords = ['factura', 'pago', 'balance', 'recibo', 'transferencia', 'banco', 'pagar', 'cuanto debo', 'corte'];
    const isBillingQuery = billingKeywords.some((kw) => messageLower.includes(kw));

    // 3. Detección de Planes y Aumento de Velocidad
    const planKeywords = ['cambiar plan', 'aumentar velocidad', 'upgrade', 'mas megas', 'mas canales', 'mejorar plan'];
    const isPlanQuery = planKeywords.some((kw) => messageLower.includes(kw));

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

    // Registrar interacción en CRM (RF-21 / RF-39)
    await this.interactionRepository.save(
      this.interactionRepository.create({
        clientId: client.id,
        userId,
        channel: 'SYSTEM_EVENT',
        subject: `Consulta Chat Portal: ${dto.message.slice(0, 50)}`,
        notes: `Cliente envió: "${dto.message}". Chatbot respondió: "${botResponse.slice(0, 150)}..."`,
      }),
    );

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
      title: `Reclamación Avería - ${contract.address?.sector || 'Cliente Portal'}`,
      description: `[RECLAMACIÓN DESDE PORTAL WEB] ${dto.description}\nZona: ${contract.address?.municipality || 'Principal'} - Sector: ${contract.address?.sector || 'S/N'}${dto.chatSummary ? `\nHistorial: ${dto.chatSummary}` : ''}`,
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
}
