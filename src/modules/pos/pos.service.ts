import { Injectable, BadRequestException, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SaleEntity } from './entities/sale.entity';
import { SaleDetailEntity } from './entities/sale-detail.entity';
import { CashRegisterEntity } from './entities/cash-register.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { ClientEntity } from '../clients/entities/client.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { CheckoutDto } from './dto/checkout.dto';
import { CollectInvoicesDto } from './dto/collect-invoices.dto';
import { OpenCashRegisterDto, CloseCashRegisterDto } from './dto/cash-register.dto';
import { InventoryService } from '../inventory/inventory.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { MorosidadService } from '../billing/morosidad.service';
import { SaleConfirmedEvent } from './events/sale-confirmed.event';
import { SystemEvents } from '../../common/enums/system-events.enum';

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly inventoryService: InventoryService,
    private readonly invoicingService: InvoicingService,
    private readonly morosidadService: MorosidadService,
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
      if (activeReg) {
        registerId = activeReg.id;
      }
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

      const discount = Number(dto.discountAmount) || 0;
      const grandTotal = Number((subtotal + itbisTotal - discount).toFixed(2));

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

      // 7. Disparar Evento de Dominio Asíncrono
      const eventPayload: SaleConfirmedEvent = {
        saleId: savedSale.id,
        clientId: savedSale.clientId,
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
  async collectInvoices(userId: string, dto: CollectInvoicesDto): Promise<SaleEntity[]> {
    const invoices = await this.invoiceRepository.find({ where: { id: In(dto.invoiceIds) } });

    if (invoices.length !== dto.invoiceIds.length) {
      throw new NotFoundException('Una o más facturas indicadas no existen');
    }

    const distinctClientIds = new Set(invoices.map((i) => i.clientId));
    if (distinctClientIds.size > 1) {
      throw new BadRequestException('Todas las facturas a cobrar deben pertenecer al mismo cliente');
    }

    const notPending = invoices.filter((i) => i.status !== 'PENDING_PAYMENT');
    if (notPending.length > 0) {
      throw new ConflictException(
        `Las siguientes facturas ya no están pendientes de pago: ${notPending.map((i) => i.id).join(', ')}`,
      );
    }

    let registerId = dto.cashRegisterId;
    if (!registerId) {
      const activeReg = await this.getActiveRegister(userId);
      if (activeReg) {
        registerId = activeReg.id;
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const settledSaleIds: string[] = [];
    const affectedContractIds = new Set<string>();

    try {
      for (const invoice of invoices) {
        const detail = queryRunner.manager.getRepository(SaleDetailEntity).create({
          itemType: 'PLAN_SUBSCRIPTION',
          concept: invoice.concept || 'Cargo recurrente de servicio',
          quantity: 1,
          unitPrice: Number(invoice.subtotal || 0),
          itbisAmount: Number(invoice.itbisTotal || 0),
          subtotal: Number(invoice.subtotal || 0),
        });

        const sale = queryRunner.manager.getRepository(SaleEntity).create({
          cashRegisterId: registerId,
          clientId: invoice.clientId,
          contractId: invoice.contractId,
          userId,
          billingPeriod: this.formatBillingPeriodLabel(invoice.billingPeriodStart),
          dueDate: invoice.dueDate,
          subtotal: Number(invoice.subtotal || 0),
          discountAmount: 0,
          itbisTotal: Number(invoice.itbisTotal || 0),
          grandTotal: Number(invoice.grandTotal || 0),
          paymentMethod: dto.paymentMethod,
          status: 'PAID',
          notes: dto.notes,
          details: [detail],
        });

        const savedSale = await queryRunner.manager.getRepository(SaleEntity).save(sale);

        await this.invoicingService.settleInvoice(invoice.id, savedSale, dto.ncfType, queryRunner);

        settledSaleIds.push(savedSale.id);
        if (invoice.contractId) {
          affectedContractIds.add(invoice.contractId);
        }
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error cobrando facturas pendientes: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }

    for (const contractId of affectedContractIds) {
      try {
        await this.morosidadService.reactivateIfSettled(contractId);
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

    const register = this.cashRegisterRepository.create({
      userId,
      openingAmount: dto.openingAmount,
      status: 'OPEN',
      notes: dto.notes,
    });

    return this.cashRegisterRepository.save(register);
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
      relations: ['sales', 'sales.invoice', 'sales.details', 'sales.client'],
    });
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
