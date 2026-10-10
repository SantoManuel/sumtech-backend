import { Injectable, Inject, BadRequestException, NotFoundException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { TENANT_DATA_SOURCE } from '../../common/tenancy/tenant-datasource.provider';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SaleEntity } from './entities/sale.entity';
import { SaleDetailEntity } from './entities/sale-detail.entity';
import { CashRegisterEntity } from './entities/cash-register.entity';
import { CashStationEntity } from './entities/cash-station.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { ClientEntity } from '../clients/entities/client.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { EmployeeEntity } from '../employees/entities/employee.entity';
import { CheckoutDto } from './dto/checkout.dto';
import { CollectInvoicesDto } from './dto/collect-invoices.dto';
import { OpenCashRegisterDto, CloseCashRegisterDto } from './dto/cash-register.dto';
import { FindCashRegistersDto } from './dto/find-cash-registers.dto';
import { CreateCashStationDto, UpdateCashStationDto } from './dto/cash-station.dto';
import { InventoryService } from '../inventory/inventory.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { MorosidadService } from '../billing/morosidad.service';
import { BillingSettingsService } from '../billing/billing-settings.service';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { SaleConfirmedEvent } from './events/sale-confirmed.event';
import { SystemEvents } from '../../common/enums/system-events.enum';
import { isOpenInvoiceStatus } from '../invoicing/invoice-status.util';
import { Role } from '../../common/enums/role.enum';

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    @Inject(TENANT_DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly inventoryService: InventoryService,
    private readonly invoicingService: InvoicingService,
    private readonly morosidadService: MorosidadService,
    private readonly billingSettingsService: BillingSettingsService,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    @InjectRepository(SaleEntity)
    private readonly saleRepository: Repository<SaleEntity>,
    @InjectRepository(CashRegisterEntity)
    private readonly cashRegisterRepository: Repository<CashRegisterEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(ClientEntity)
    private readonly clientRepository: Repository<ClientEntity>,
    @InjectRepository(InvoiceEntity)
    private readonly invoiceRepository: Repository<InvoiceEntity>,
    @InjectRepository(CashStationEntity)
    private readonly cashStationRepository: Repository<CashStationEntity>,
    @InjectRepository(EmployeeEntity)
    private readonly employeeRepository: Repository<EmployeeEntity>,
  ) {}

  /**
   * Ejecuta el checkout transaccional ACID en el POS:
   * 1. Valida el cliente y contratos.
   * 2. Ajusta el día de pago del cliente (billingDay) si fue modificado.
   * 3. Reserva y descuenta stock para hardware físico.
   * 4. Registra la venta y líneas de detalle.
   * 5. Emite y timbra la Factura Electrónica e-CF en la DGII.
   * 6. Dispara eventos de dominio asíncronos.
   */
  async checkout(userId: string, dto: CheckoutDto): Promise<SaleEntity> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('El carrito de venta no puede estar vacío');
    }

    const client = await this.clientRepository.findOne({
      where: { id: dto.clientId },
      relations: ['contracts', 'contracts.plan'],
    });

    if (!client) {
      throw new NotFoundException(`Cliente con ID ${dto.clientId} no encontrado`);
    }

    // Verificar turno de caja activo
    let registerId = dto.cashRegisterId;
    if (!registerId) {
      const activeReg = await this.getActiveRegister(userId);
      registerId = activeReg?.id;
    }
    if (!registerId) {
      throw new BadRequestException('Debe abrir un turno de caja antes de registrar una venta.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Si se especifica contrato y día de corte, actualizar el contrato
      if (dto.contractId) {
        const contract = await queryRunner.manager.getRepository(ContractEntity).findOne({
          where: { id: dto.contractId },
        });

        if (contract) {
          if (dto.billingDay && dto.billingDay >= 1 && dto.billingDay <= 31) {
            contract.billingDay = dto.billingDay;
          }
          if (contract.status === 'SUSPENDED') {
            contract.status = 'ACTIVE';
          }
          await queryRunner.manager.getRepository(ContractEntity).save(contract);
        }
      }

      // 2. Filtrar hardware físico para reserva de stock en almacén
      const hardwareItems = dto.items
        .filter((item) => item.itemType === 'PRODUCT_HARDWARE' && item.itemId)
        .map((item) => ({ productId: item.itemId!, quantity: item.quantity }));

      if (hardwareItems.length > 0) {
        await this.inventoryService.reserveStockForSale(hardwareItems, queryRunner);
      }

      // 3. Calcular montos
      let subtotal = 0;
      let itbisTotal = 0;
      const details: SaleDetailEntity[] = [];

      for (const item of dto.items) {
        const itemSubtotal = Number(item.unitPrice) * item.quantity;
        const itemItbis = Number(item.itbisAmount) || 0;
        subtotal += itemSubtotal;
        itbisTotal += itemItbis;

        const detail = queryRunner.manager.getRepository(SaleDetailEntity).create({
          itemType: item.itemType,
          itemId: item.itemId,
          concept: item.concept,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          itbisAmount: itemItbis,
          subtotal: itemSubtotal,
        });
        details.push(detail);
      }

      let discount = 0;
      const discountType: 'FIXED' | 'PERCENTAGE' = dto.discountType || 'FIXED';
      let discountPercentage: number | undefined = undefined;

      if (dto.discountType === 'PERCENTAGE' && dto.discountPercentage !== undefined) {
        discountPercentage = Number(dto.discountPercentage);
        discount = Number(((subtotal * discountPercentage) / 100).toFixed(2));
      } else if (dto.discountAmount) {
        discount = Number(dto.discountAmount);
      }

      if (discount > subtotal) {
        discount = subtotal;
      }

      let authorizedSupervisorId: string | null = null;
      if (discount > 0) {
        authorizedSupervisorId = await this.resolveDiscountAuthorization(userId, discount, {
          discountReason: dto.discountReason,
          supervisorEmail: dto.supervisorEmail,
          supervisorPassword: dto.supervisorPassword,
        });
      }

      const grandTotal = Math.max(0, Number((subtotal + itbisTotal - discount).toFixed(2)));

      // 4. Crear Venta
      const sale = queryRunner.manager.getRepository(SaleEntity).create({
        cashRegisterId: registerId,
        clientId: dto.clientId,
        contractId: dto.contractId,
        userId,
        billingPeriod: dto.billingPeriod,
        dueDate: dto.dueDate,
        subtotal,
        discountAmount: discount,
        discountType,
        discountPercentage: discountType === 'PERCENTAGE' ? discountPercentage : undefined,
        discountReason: discount > 0 ? dto.discountReason : undefined,
        discountAuthorizedById: authorizedSupervisorId || undefined,
        itbisTotal,
        grandTotal,
        paymentMethod: dto.paymentMethod,
        status: 'PAID',
        notes: dto.notes,
        details,
      });

      const savedSale = await queryRunner.manager.getRepository(SaleEntity).save(sale);

      // 5. Timbrar Factura Electrónica e-CF DGII
      const invoice = await this.invoicingService.emitInvoice(
        { saleId: savedSale.id, ncfType: dto.ncfType },
        queryRunner,
      );

      // 6. Commit de la Transacción ACID
      await queryRunner.commitTransaction();

      // 6b. Archivado best-effort del XML firmado + constancia DGII en MinIO,
      // aislado por tenant — después del commit para nunca archivar un
      // documento cuya venta termine en rollback.
      await this.invoicingService.archiveSettledInvoice(invoice);

      // 7. Disparar Evento de Dominio Asíncrono
      const eventPayload: SaleConfirmedEvent = {
        saleId: savedSale.id,
        clientId: savedSale.clientId,
        userId,
        planIds: dto.items
          .filter((i) => (i.itemType === 'PLAN_ACTIVATION' || i.itemType === 'PLAN_SUBSCRIPTION') && i.itemId)
          .map((i) => i.itemId!),
        ncfNumber: invoice.ncfNumber!,
        grandTotal: savedSale.grandTotal,
        occurredOn: new Date(),
      };

      this.eventEmitter.emit(SystemEvents.SALE_CONFIRMED, eventPayload);

      // Retornar venta con relaciones completas
      return this.findSaleById(savedSale.id);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error en checkout transaccional: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Cobra una o más facturas recurrentes PENDING_PAYMENT del mismo cliente en una
   * sola transacción de caja (todo o nada): crea una Venta+Detalle por cada
   * factura (preservando la relación 1:1 Venta-Factura) y delega en
   * InvoicingService.settleInvoice() la asignación del NCF y el timbrado DGII,
   * que solo ocurre en este momento del cobro. A diferencia de checkout() (venta
   * ad-hoc), aquí NO se emite SALE_CONFIRMED: ese evento registra la venta como
   * interacción comercial en el CRM (ver CrmSaleListener), lo cual no aplica al
   * pago mensual recurrente de un servicio ya instalado, sino solo a ventas
   * ad-hoc nuevas.
   */
  async collectInvoices(
    userId: string,
    dto: CollectInvoicesDto,
    roles: string[] = [],
    options: { skipCashRegisterCheck?: boolean } = {},
  ): Promise<SaleEntity[]> {
    const invoices = await this.invoiceRepository.find({ where: { id: In(dto.invoiceIds) } });

    if (invoices.length !== dto.invoiceIds.length) {
      throw new NotFoundException('Una o más facturas indicadas no existen');
    }

    const distinctClientIds = new Set(invoices.map((i) => i.clientId));
    if (distinctClientIds.size > 1) {
      throw new BadRequestException('Todas las facturas a cobrar deben pertenecer al mismo cliente');
    }

    const notPending = invoices.filter((i) => !isOpenInvoiceStatus(i.status));
    if (notPending.length > 0) {
      throw new ConflictException(
        `Las siguientes facturas ya no están pendientes de pago: ${notPending.map((i) => i.id).join(', ')}`,
      );
    }

    let suspendedContract: ContractEntity | null = null;
    if (dto.applyReconnectionFee) {
      const distinctContractIds = new Set(invoices.map((i) => i.contractId).filter(Boolean));
      if (distinctContractIds.size !== 1) {
        throw new BadRequestException(
          'El cargo de reconexión solo puede aplicarse cuando todas las facturas del lote pertenecen a un único contrato',
        );
      }
      const [contractId] = distinctContractIds;
      suspendedContract = await this.contractRepository.findOneBy({ id: contractId as string });
      if (!suspendedContract || suspendedContract.status !== 'SUSPENDED') {
        throw new BadRequestException('El cargo de reconexión solo aplica a un contrato actualmente SUSPENDED');
      }
    }

    let registerId = dto.cashRegisterId;
    if (!registerId) {
      const activeReg = await this.getActiveRegister(userId);
      registerId = activeReg?.id;
    }
    const isFieldCollection = roles.includes(Role.TECNICO);
    if (!registerId && !isFieldCollection && !options.skipCashRegisterCheck) {
      throw new BadRequestException('Debe abrir un turno de caja antes de cobrar facturas.');
    }

    // Si viene descuento puntual, validarlo y autorizarlo antes de tocar la base de datos
    let targetInvoiceDiscount = 0;
    let targetInvoiceId: string | null = null;
    let discountAuthorizedSupervisorId: string | null = null;
    let discountType: 'FIXED' | 'PERCENTAGE' = 'FIXED';
    let discountPercentage: number | undefined = undefined;
    let discountReason: string | undefined = undefined;

    if (
      dto.discount &&
      ((dto.discount.amount && dto.discount.amount > 0) ||
        (dto.discount.percentage && dto.discount.percentage > 0))
    ) {
      targetInvoiceId = dto.discount.invoiceId;
      const targetInvoice = invoices.find((inv) => inv.id === targetInvoiceId);
      if (!targetInvoice) {
        throw new BadRequestException('La factura indicada para el descuento no forma parte del lote a cobrar');
      }

      discountType = dto.discount.type || (dto.discount.percentage !== undefined ? 'PERCENTAGE' : 'FIXED');
      const invoiceSubtotal = Number(targetInvoice.subtotal || 0);

      if (discountType === 'PERCENTAGE' && dto.discount.percentage !== undefined) {
        discountPercentage = Number(dto.discount.percentage);
        targetInvoiceDiscount = Number(((invoiceSubtotal * discountPercentage) / 100).toFixed(2));
      } else if (dto.discount.amount) {
        targetInvoiceDiscount = Number(dto.discount.amount);
      }

      if (targetInvoiceDiscount > invoiceSubtotal) {
        targetInvoiceDiscount = invoiceSubtotal;
      }

      if (targetInvoiceDiscount > 0) {
        discountReason = dto.discount.reason;
        discountAuthorizedSupervisorId = await this.resolveDiscountAuthorization(userId, targetInvoiceDiscount, {
          discountReason,
          supervisorEmail: dto.discount.supervisorEmail,
          supervisorPassword: dto.discount.supervisorPassword,
        });
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const settledSaleIds: string[] = [];
    const settledInvoices: InvoiceEntity[] = [];
    const affectedContractIds = new Set<string>();
    let reconnectionFeeInvoiceId: string | undefined;

    try {
      for (const invoice of invoices) {
        const isDiscountTarget = Boolean(targetInvoiceId && invoice.id === targetInvoiceId);
        const currentDiscount = isDiscountTarget ? targetInvoiceDiscount : 0;
        const subtotalNum = Number(invoice.subtotal || 0);
        const itbisNum = Number(invoice.itbisTotal || 0);
        const currentGrandTotal = Math.max(0, Number((subtotalNum + itbisNum - currentDiscount).toFixed(2)));

        const detail = queryRunner.manager.getRepository(SaleDetailEntity).create({
          itemType: 'PLAN_SUBSCRIPTION',
          concept: invoice.concept || 'Cargo recurrente de servicio',
          quantity: 1,
          unitPrice: subtotalNum,
          itbisAmount: itbisNum,
          subtotal: subtotalNum,
        });

        const sale = queryRunner.manager.getRepository(SaleEntity).create({
          cashRegisterId: registerId,
          clientId: invoice.clientId,
          contractId: invoice.contractId,
          userId,
          billingPeriod: this.formatBillingPeriodLabel(invoice.billingPeriodStart),
          dueDate: invoice.dueDate,
          subtotal: subtotalNum,
          discountAmount: currentDiscount,
          discountType: isDiscountTarget ? discountType : 'FIXED',
          discountPercentage: isDiscountTarget ? discountPercentage : undefined,
          discountReason: isDiscountTarget ? discountReason : undefined,
          discountAuthorizedById: isDiscountTarget ? (discountAuthorizedSupervisorId || undefined) : undefined,
          itbisTotal: itbisNum,
          grandTotal: currentGrandTotal,
          paymentMethod: dto.paymentMethod,
          status: 'PAID',
          notes: dto.notes,
          details: [detail],
        });

        const savedSale = await queryRunner.manager.getRepository(SaleEntity).save(sale);

        const settledInvoice = await this.invoicingService.settleInvoice(invoice.id, savedSale, dto.ncfType, queryRunner);
        settledInvoices.push(settledInvoice);

        settledSaleIds.push(savedSale.id);
        if (invoice.contractId) {
          affectedContractIds.add(invoice.contractId);
        }
      }

      if (suspendedContract) {
        const settings = await this.billingSettingsService.getSettings();
        const feeAmount = Number(settings.reconnectionFeeAmount);
        const feeItbis = Number((feeAmount * 0.18).toFixed(2));

        const feeDetail = queryRunner.manager.getRepository(SaleDetailEntity).create({
          itemType: 'RECONNECTION_FEE',
          concept: 'Cargo de Reconexión de Servicio',
          quantity: 1,
          unitPrice: feeAmount,
          itbisAmount: feeItbis,
          subtotal: feeAmount,
        });

        const feeSale = queryRunner.manager.getRepository(SaleEntity).create({
          cashRegisterId: registerId,
          clientId: suspendedContract.clientId,
          contractId: suspendedContract.id,
          userId,
          subtotal: feeAmount,
          discountAmount: 0,
          itbisTotal: feeItbis,
          grandTotal: Number((feeAmount + feeItbis).toFixed(2)),
          paymentMethod: dto.paymentMethod,
          status: 'PAID',
          notes: dto.notes,
          details: [feeDetail],
        });

        const savedFeeSale = await queryRunner.manager.getRepository(SaleEntity).save(feeSale);
        const feeInvoice = await this.invoicingService.emitInvoice(
          { saleId: savedFeeSale.id, ncfType: dto.ncfType },
          queryRunner,
        );

        reconnectionFeeInvoiceId = feeInvoice.id;
        settledInvoices.push(feeInvoice);
        settledSaleIds.push(savedFeeSale.id);
        affectedContractIds.add(suspendedContract.id);
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error cobrando facturas pendientes: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }

    // Archivado best-effort del XML firmado + constancia DGII en MinIO,
    // aislado por tenant — después del commit, una vez confirmado que
    // ninguna de estas facturas puede ya hacer rollback.
    for (const settledInvoice of settledInvoices) {
      await this.invoicingService.archiveSettledInvoice(settledInvoice);
    }

    // Emitir evento INVOICE_PAID para cada factura cobrada (RF-BILL-003 / PPPOE-007)
    for (const invoice of invoices) {
      this.eventEmitter.emit(SystemEvents.INVOICE_PAID, {
        invoiceId: invoice.id,
        contractId: invoice.contractId,
        clientId: invoice.clientId,
        amount: Number(invoice.grandTotal || 0),
        paymentMethod: dto.paymentMethod,
        paidAt: new Date(),
        occurredOn: new Date(),
      });
    }

    for (const contractId of affectedContractIds) {
      try {
        await this.morosidadService.reactivateIfSettled(
          contractId,
          contractId === suspendedContract?.id ? reconnectionFeeInvoiceId : undefined,
        );
      } catch (error) {
        this.logger.error(
          `Error reactivando el contrato ${contractId} tras el cobro: ${error.message}`,
          error.stack,
        );
      }
    }

    return Promise.all(settledSaleIds.map((id) => this.findSaleById(id)));
  }

  private formatBillingPeriodLabel(billingPeriodStart?: string): string | undefined {
    if (!billingPeriodStart) {
      return undefined;
    }
    const [year, month] = billingPeriodStart.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });
  }

  /**
   * Helper centralizado para validar y autorizar descuentos manuales en ventanilla y cobro de facturas.
   * Reglas de negocio:
   * 1. Si discountAmount <= 0, retorna null (sin autorización requerida).
   * 2. Si discountAmount > 0, el motivo (discountReason) es estrictamente obligatorio.
   * 3. Si el solicitante tiene rol ADMIN o GERENTE, está exento del tope (retorna su propio userId como autorizador).
   * 4. Si el solicitante es CAJERO:
   *    - Si discountAmount <= cashierDiscountCapAmount (de BillingSettings, default 500), pasa sin supervisor (retorna null).
   *    - Si discountAmount > cashierDiscountCapAmount, requiere credenciales válidas de supervisor (ADMIN/GERENTE).
   *    - Si faltan credenciales o son inválidas, rechaza antes de tocar la DB.
   */
  private async resolveDiscountAuthorization(
    requestingUserId: string,
    discountAmount: number,
    params: {
      discountReason?: string;
      supervisorEmail?: string;
      supervisorPassword?: string;
    },
  ): Promise<string | null> {
    if (!discountAmount || discountAmount <= 0) {
      return null;
    }

    if (!params.discountReason || !params.discountReason.trim()) {
      throw new BadRequestException('El motivo del descuento es obligatorio para cualquier monto mayor a cero');
    }

    const requestingUser = await this.usersService.findById(requestingUserId);
    const userRoleNames = (requestingUser?.roles || []).map((r) => r.name);
    const isExemptSupervisor = userRoleNames.some((r) => ['ADMIN', 'GERENTE'].includes(r));

    if (isExemptSupervisor) {
      return requestingUserId;
    }

    const settings = await this.billingSettingsService.getSettings();
    const cap = Number(settings.cashierDiscountCapAmount ?? 500);

    if (discountAmount <= cap) {
      return null;
    }

    if (!params.supervisorEmail || !params.supervisorPassword) {
      throw new ForbiddenException(
        `El descuento aplicado (RD$ ${discountAmount.toFixed(2)}) supera el tope permitido para cajeros (RD$ ${cap.toFixed(2)}). Se requiere autorización de un supervisor (ADMIN o GERENTE).`,
      );
    }

    const supervisor = await this.authService.verifySupervisorCredentials(
      params.supervisorEmail,
      params.supervisorPassword,
    );

    return supervisor.id;
  }

  async findSaleById(id: string): Promise<SaleEntity> {
    const sale = await this.saleRepository.findOne({
      where: { id },
      relations: ['client', 'details', 'invoice', 'user', 'contract', 'contract.plan'],
    });
    if (!sale) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }
    return sale;
  }

  async openCashRegister(userId: string, dto: OpenCashRegisterDto): Promise<CashRegisterEntity> {
    const openRegister = await this.cashRegisterRepository.findOne({
      where: { userId, status: 'OPEN' },
    });
    if (openRegister) {
      throw new BadRequestException('El usuario ya cuenta con un turno de caja abierto');
    }

    // Si no se especifica caja explícitamente, usar la caja por defecto del
    // empleado (asignada en /dashboard/empleados) cuando exista — ADMIN/GERENTE
    // sin empleado vinculado a una caja simplemente abren sin estación asociada.
    let cashStationId = dto.cashStationId;
    if (!cashStationId) {
      const employee = await this.employeeRepository.findOne({ where: { userId } });
      cashStationId = employee?.defaultCashStationId;
    }

    const register = this.cashRegisterRepository.create({
      userId,
      openingAmount: dto.openingAmount,
      status: 'OPEN',
      notes: dto.notes,
      cashStationId,
    });

    return this.cashRegisterRepository.save(register);
  }

  async findAllCashStations(branchId?: string, activeOnly = false): Promise<CashStationEntity[]> {
    return this.cashStationRepository.find({
      where: {
        ...(branchId ? { branchId } : {}),
        ...(activeOnly ? { isActive: true } : {}),
      },
      relations: ['branch'],
      order: { name: 'ASC' },
    });
  }

  async createCashStation(dto: CreateCashStationDto): Promise<CashStationEntity> {
    const station = this.cashStationRepository.create(dto);
    return this.cashStationRepository.save(station);
  }

  async updateCashStation(id: string, dto: UpdateCashStationDto): Promise<CashStationEntity> {
    const station = await this.cashStationRepository.findOne({ where: { id } });
    if (!station) {
      throw new NotFoundException(`Caja con ID ${id} no encontrada`);
    }
    Object.assign(station, dto);
    return this.cashStationRepository.save(station);
  }

  async closeCashRegister(id: string, dto: CloseCashRegisterDto): Promise<CashRegisterEntity> {
    const register = await this.cashRegisterRepository.findOne({
      where: { id },
      relations: ['sales', 'sales.invoice'],
    });
    if (!register || register.status === 'CLOSED') {
      throw new BadRequestException('Caja no encontrada o ya se encuentra cerrada');
    }

    const totalSales = register.sales?.reduce((sum, s) => sum + Number(s.grandTotal), 0) || 0;
    const expectedClosing = Number(register.openingAmount) + totalSales;
    const difference = dto.realClosingAmount - expectedClosing;

    register.expectedClosingAmount = expectedClosing;
    register.realClosingAmount = dto.realClosingAmount;
    register.difference = difference;
    register.status = 'CLOSED';
    register.closingDate = new Date();
    if (dto.notes) register.notes = `${register.notes || ''} | Cierre: ${dto.notes}`;

    return this.cashRegisterRepository.save(register);
  }

  async getActiveRegister(userId: string): Promise<CashRegisterEntity | null> {
    return this.cashRegisterRepository.findOne({
      where: { userId, status: 'OPEN' },
      relations: ['sales', 'sales.invoice', 'sales.details', 'sales.client', 'cashStation', 'cashStation.branch'],
    });
  }

  /**
   * Historial paginado de turnos de caja (abiertos y cerrados), con totales de
   * ventas por turno precalculados en una sola query agregada (evita N+1 sobre
   * getShiftSummary por cada fila de la lista). `restrictToUserId` lo fija el
   * controller cuando quien consulta es CAJERO: sin importar el `userId` que
   * venga en el DTO, solo ve su propio historial.
   */
  async findAllCashRegisters(dto: FindCashRegistersDto, restrictToUserId?: string) {
    const page = dto.page || 1;
    const limit = dto.limit || 20;
    const skip = (page - 1) * limit;

    const query = this.cashRegisterRepository
      .createQueryBuilder('register')
      .leftJoinAndSelect('register.user', 'user')
      .leftJoinAndSelect('register.cashStation', 'cashStation')
      .leftJoinAndSelect('cashStation.branch', 'branch')
      .orderBy('register.openingDate', 'DESC')
      .skip(skip)
      .take(limit);

    if (restrictToUserId) {
      query.andWhere('register.userId = :restrictToUserId', { restrictToUserId });
    } else if (dto.userId) {
      query.andWhere('register.userId = :userId', { userId: dto.userId });
    }
    if (dto.status) {
      query.andWhere('register.status = :status', { status: dto.status });
    }
    if (dto.dateFrom) {
      query.andWhere('register.openingDate >= :dateFrom', { dateFrom: dto.dateFrom });
    }
    if (dto.dateTo) {
      query.andWhere('register.openingDate < (:dateTo::date + interval \'1 day\')', { dateTo: dto.dateTo });
    }
    if (dto.cashStationId) {
      query.andWhere('register.cashStationId = :cashStationId', { cashStationId: dto.cashStationId });
    }
    if (dto.branchId) {
      query.andWhere('cashStation.branchId = :branchId', { branchId: dto.branchId });
    }

    const [registers, total] = await query.getManyAndCount();

    const registerIds = registers.map((r) => r.id);
    const salesTotals = registerIds.length
      ? await this.saleRepository
          .createQueryBuilder('sale')
          .select('sale.cashRegisterId', 'cashRegisterId')
          .addSelect('COUNT(*)', 'totalTransactions')
          .addSelect('SUM(sale.grandTotal)', 'grandTotalSales')
          .where('sale.cashRegisterId IN (:...registerIds)', { registerIds })
          .groupBy('sale.cashRegisterId')
          .getRawMany()
      : [];

    const totalsByRegister = new Map(
      salesTotals.map((row) => [
        row.cashRegisterId,
        { totalTransactions: Number(row.totalTransactions), grandTotalSales: Number(row.grandTotalSales) },
      ]),
    );

    const data = registers.map((register) => ({
      ...register,
      totalTransactions: totalsByRegister.get(register.id)?.totalTransactions || 0,
      grandTotalSales: totalsByRegister.get(register.id)?.grandTotalSales || 0,
    }));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Reporte agregado de caja para /dashboard/reportes: totales del periodo
   * (por método de pago, ITBIS) y el mismo desglose por cajero, más el arqueo
   * acumulado (diferencias de cierre) de los turnos cerrados en el periodo.
   * `startDate`/`endDate` filtran `sales.createdAt` (venta) y `cash_registers.closingDate`
   * (arqueo) — dos fechas distintas del mismo rango, cada una sobre su propia tabla.
   */
  async getCajaReport(startDate?: string, endDate?: string, branchId?: string) {
    const salesQuery = this.saleRepository
      .createQueryBuilder('sale')
      .leftJoin('sale.user', 'user')
      .select('sale.userId', 'userId')
      .addSelect('user.username', 'username')
      .addSelect('COUNT(*)', 'totalTransactions')
      .addSelect('SUM(sale.grandTotal)', 'totalSales')
      .addSelect('SUM(sale.itbisTotal)', 'totalTax')
      .addSelect(`SUM(CASE WHEN sale.paymentMethod = 'CASH' THEN sale.grandTotal ELSE 0 END)`, 'cashSales')
      .addSelect(
        `SUM(CASE WHEN sale.paymentMethod IN ('CARD_DEBIT', 'CARD_CREDIT') THEN sale.grandTotal ELSE 0 END)`,
        'cardSales',
      )
      .addSelect(`SUM(CASE WHEN sale.paymentMethod = 'BANK_TRANSFER' THEN sale.grandTotal ELSE 0 END)`, 'transferSales')
      .groupBy('sale.userId')
      .addGroupBy('user.username');

    if (startDate) {
      salesQuery.andWhere('sale.createdAt >= :startDate', { startDate });
    }
    if (endDate) {
      salesQuery.andWhere("sale.createdAt < (:endDate::date + interval '1 day')", { endDate });
    }
    if (branchId) {
      salesQuery
        .leftJoin('sale.cashRegister', 'cashRegister')
        .leftJoin('cashRegister.cashStation', 'cashStation')
        .andWhere('cashStation.branchId = :branchId', { branchId });
    }

    const salesByCashier = await salesQuery.getRawMany();

    const registersQuery = this.cashRegisterRepository
      .createQueryBuilder('register')
      .leftJoin('register.user', 'user')
      .select('register.userId', 'userId')
      .addSelect('user.username', 'username')
      .addSelect('COUNT(*)', 'closedRegisters')
      .addSelect('SUM(register.difference)', 'totalDifference')
      .addSelect(`SUM(CASE WHEN register.difference <> 0 THEN 1 ELSE 0 END)`, 'registersWithDifference')
      .where('register.status = :status', { status: 'CLOSED' })
      .groupBy('register.userId')
      .addGroupBy('user.username');

    if (startDate) {
      registersQuery.andWhere('register.closingDate >= :startDate', { startDate });
    }
    if (endDate) {
      registersQuery.andWhere("register.closingDate < (:endDate::date + interval '1 day')", { endDate });
    }
    if (branchId) {
      registersQuery.leftJoin('register.cashStation', 'cashStation').andWhere('cashStation.branchId = :branchId', { branchId });
    }

    const registersByCashier = await registersQuery.getRawMany();
    const registerUsernameByUser = new Map(registersByCashier.map((row) => [row.userId, row.username]));
    const registerTotalsByUser = new Map(
      registersByCashier.map((row) => [
        row.userId,
        {
          closedRegisters: Number(row.closedRegisters),
          totalDifference: Number(row.totalDifference || 0),
          registersWithDifference: Number(row.registersWithDifference),
        },
      ]),
    );

    const byCashier = salesByCashier.map((row) => {
      const registerTotals = registerTotalsByUser.get(row.userId) || {
        closedRegisters: 0,
        totalDifference: 0,
        registersWithDifference: 0,
      };
      return {
        userId: row.userId,
        username: row.username || 'Cajero',
        totalTransactions: Number(row.totalTransactions),
        totalSales: Number(row.totalSales),
        totalTax: Number(row.totalTax),
        cashSales: Number(row.cashSales),
        cardSales: Number(row.cardSales),
        transferSales: Number(row.transferSales),
        ...registerTotals,
      };
    });

    // Cajeros con turnos cerrados en el periodo pero sin ventas asociadas
    // (ej. abrió y cerró sin cobrar nada) — igual deben figurar en el arqueo.
    for (const [userId, registerTotals] of registerTotalsByUser) {
      if (!byCashier.some((c) => c.userId === userId)) {
        byCashier.push({
          userId,
          username: registerUsernameByUser.get(userId) || 'Cajero',
          totalTransactions: 0,
          totalSales: 0,
          totalTax: 0,
          cashSales: 0,
          cardSales: 0,
          transferSales: 0,
          ...registerTotals,
        });
      }
    }

    const summary = byCashier.reduce(
      (acc, c) => ({
        totalTransactions: acc.totalTransactions + c.totalTransactions,
        totalSales: acc.totalSales + c.totalSales,
        totalTax: acc.totalTax + c.totalTax,
        cashSales: acc.cashSales + c.cashSales,
        cardSales: acc.cardSales + c.cardSales,
        transferSales: acc.transferSales + c.transferSales,
        closedRegisters: acc.closedRegisters + c.closedRegisters,
        totalDifference: acc.totalDifference + c.totalDifference,
        registersWithDifference: acc.registersWithDifference + c.registersWithDifference,
      }),
      {
        totalTransactions: 0,
        totalSales: 0,
        totalTax: 0,
        cashSales: 0,
        cardSales: 0,
        transferSales: 0,
        closedRegisters: 0,
        totalDifference: 0,
        registersWithDifference: 0,
      },
    );

    return { summary, byCashier: byCashier.sort((a, b) => b.totalSales - a.totalSales) };
  }

  async getShiftSummary(registerId: string) {
    const register = await this.cashRegisterRepository.findOne({
      where: { id: registerId },
      relations: ['sales', 'sales.invoice', 'sales.details', 'user'],
    });

    if (!register) {
      throw new NotFoundException(`Turno de caja con ID ${registerId} no encontrado`);
    }

    const sales = register.sales || [];
    const totalTransactions = sales.length;

    let cashSales = 0;
    let cardSales = 0;
    let transferSales = 0;
    let totalTax = 0;
    let grandTotalSales = 0;

    const ncfBreakdown: Record<string, number> = {};

    sales.forEach((s) => {
      const amount = Number(s.grandTotal);
      const tax = Number(s.itbisTotal);
      grandTotalSales += amount;
      totalTax += tax;

      if (s.paymentMethod === 'CASH') cashSales += amount;
      else if (s.paymentMethod === 'CARD_DEBIT' || s.paymentMethod === 'CARD_CREDIT') cardSales += amount;
      else if (s.paymentMethod === 'BANK_TRANSFER') transferSales += amount;

      const ncfType = s.invoice?.ncfType || 'E31';
      ncfBreakdown[ncfType] = (ncfBreakdown[ncfType] || 0) + 1;
    });

    const expectedCashInDrawer = Number(register.openingAmount) + cashSales;

    return {
      registerId: register.id,
      cashier: register.user?.username || 'Cajero',
      status: register.status,
      openingAmount: Number(register.openingAmount),
      openingDate: register.openingDate,
      closingDate: register.closingDate,
      realClosingAmount: register.realClosingAmount ? Number(register.realClosingAmount) : null,
      difference: register.difference ? Number(register.difference) : null,
      totalTransactions,
      grandTotalSales,
      totalTax,
      breakdown: {
        cashSales,
        cardSales,
        transferSales,
        expectedCashInDrawer,
      },
      ncfBreakdown,
    };
  }
}
