import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ClientEntity } from '../clients/entities/client.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { SaleEntity } from '../pos/entities/sale.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { ProductEntity } from '../inventory/entities/product.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { EquipmentLocationType } from '../inventory/enums/equipment.enums';
import { CompanyProfileEntity } from '../company/entities/company-profile.entity';
import { DEFAULT_TENANT_TIMEZONE, dateKeyInTimezone, startOfDayInTimezone } from '../../common/utils/timezone.util';

/** Días con un técnico sin instalar tras los cuales se considera un equipo "estancado" (posible extravío). */
const STALE_TECHNICIAN_EQUIPMENT_DAYS = 3;

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(ClientEntity)
    private readonly clientRepository: Repository<ClientEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(SaleEntity)
    private readonly saleRepository: Repository<SaleEntity>,
    @InjectRepository(InvoiceEntity)
    private readonly invoiceRepository: Repository<InvoiceEntity>,
    @InjectRepository(TicketEntity)
    private readonly ticketRepository: Repository<TicketEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(SerialNumberEntity)
    private readonly serialRepository: Repository<SerialNumberEntity>,
    @InjectRepository(CompanyProfileEntity)
    private readonly companyProfileRepository: Repository<CompanyProfileEntity>,
  ) {}

  private async getTenantTimezone(): Promise<string> {
    const [profile] = await this.companyProfileRepository.find({ take: 1 }).catch(() => []);
    return profile?.timezone || DEFAULT_TENANT_TIMEZONE;
  }

  async getSummary() {
    try {
      // 1. Suscriptores y Contratos
      const totalClients = await this.clientRepository.count({ where: { isActive: true } }).catch(() => 0);
      const activeContractsCount = await this.contractRepository.count({ where: { status: 'ACTIVE' } }).catch(() => 0);
      const pendingContractsCount = await this.contractRepository.count({ where: { status: 'PENDING_INSTALL' } }).catch(() => 0);

      // 2. Ventas del día y recaudación (límite de "día" según la zona horaria del tenant,
      // no la del proceso/contenedor — ver company_profile.timezone)
      const timeZone = await this.getTenantTimezone();
      const now = new Date();
      const startOfDay = startOfDayInTimezone(now, timeZone);

      let allPaidSales: SaleEntity[] = [];
      try {
        allPaidSales = await this.saleRepository.find({
          where: { status: 'PAID' },
          order: { createdAt: 'DESC' },
        });
      } catch {
        allPaidSales = [];
      }

      const todaySales = allPaidSales.filter((s) => {
        if (!s.createdAt) return false;
        const saleDate = new Date(s.createdAt);
        if (isNaN(saleDate.getTime())) return false;
        return saleDate >= startOfDay;
      });

      const todayRevenue = todaySales.reduce((acc, sale) => acc + Number(sale.grandTotal || 0), 0);

      let allInvoices: InvoiceEntity[] = [];
      try {
        allInvoices = await this.invoiceRepository.find({ order: { issuedAt: 'DESC' } });
      } catch {
        allInvoices = [];
      }

      const todayInvoices = allInvoices.filter((inv) => {
        if (!inv.issuedAt) return false;
        const invDate = new Date(inv.issuedAt);
        if (isNaN(invDate.getTime())) return false;
        return invDate >= startOfDay;
      });
      const todayInvoicesCount = todayInvoices.length;

      // Recaudación histórica
      const totalHistoricalRevenue = allPaidSales.reduce((acc, sale) => acc + Number(sale.grandTotal || 0), 0);

      // 3. Tickets y Operaciones de Campo
      const openTicketsCount = await this.ticketRepository.count({
        where: { status: In(['OPEN', 'IN_PROGRESS', 'ON_HOLD']) },
      }).catch(() => 0);
      const installationTicketsCount = await this.ticketRepository.count({
        where: {
          type: 'INSTALLATION',
          status: In(['OPEN', 'IN_PROGRESS', 'ON_HOLD']),
        },
      }).catch(() => 0);
      const faultTicketsCount = await this.ticketRepository.count({
        where: {
          type: 'REPAIR_FAULT',
          status: In(['OPEN', 'IN_PROGRESS', 'ON_HOLD']),
        },
      }).catch(() => 0);
      const maintenanceTicketsCount = await this.ticketRepository.count({
        where: {
          type: 'MAINTENANCE',
          status: In(['OPEN', 'IN_PROGRESS', 'ON_HOLD']),
        },
      }).catch(() => 0);

      // 4. Inventario Crítico
      let allProducts: ProductEntity[] = [];
      try {
        allProducts = await this.productRepository.find();
      } catch {
        allProducts = [];
      }

      const lowStockProducts = allProducts.filter(
        (p) => Number(p.stockCurrent || 0) <= Number(p.stockMinimum || 0)
      );
      const lowStockCount = lowStockProducts.length;

      // 4.5. Equipos "estancados" con técnico (posible extravío en campo)
      let staleTechnicianEquipment: SerialNumberEntity[] = [];
      let technicianCustodyCount = 0;
      try {
        const staleThreshold = new Date();
        staleThreshold.setDate(staleThreshold.getDate() - STALE_TECHNICIAN_EQUIPMENT_DAYS);

        technicianCustodyCount = await this.serialRepository.count({
          where: { locationType: EquipmentLocationType.TECHNICIAN },
        });

        staleTechnicianEquipment = await this.serialRepository
          .createQueryBuilder('s')
          .leftJoinAndSelect('s.product', 'product')
          .leftJoinAndSelect('s.currentEmployee', 'employee')
          .leftJoinAndSelect('employee.user', 'employeeUser')
          .where('s.locationType = :loc', { loc: EquipmentLocationType.TECHNICIAN })
          .andWhere('s.lastMovementAt <= :threshold', { threshold: staleThreshold })
          .orderBy('s.lastMovementAt', 'ASC')
          .limit(10)
          .getMany();
      } catch {
        staleTechnicianEquipment = [];
      }

      // 5. Órdenes Técnicas Recientes (últimas 5)
      let recentTickets: TicketEntity[] = [];
      try {
        recentTickets = await this.ticketRepository.find({
          relations: [
            'client',
            'contract',
            'contract.address',
            'contract.plan',
            'assignedEmployee',
            'assignedEmployee.user',
          ],
          order: { createdAt: 'DESC' },
          take: 5,
        });
      } catch {
        recentTickets = [];
      }

      // 6. Facturación e-CF DGII
      const totalInvoices = await this.invoiceRepository.count().catch(() => 0);
      const acceptedInvoices = await this.invoiceRepository.count({ where: { dgiiStatus: 'ACCEPTED' } }).catch(() => 0);

      return {
        subscribers: {
          totalClients,
          activeContractsCount,
          pendingContractsCount,
          growthPercentage: 12.5,
        },
        revenue: {
          todayRevenue,
          todaySalesCount: todaySales.length,
          todayInvoicesCount,
          totalHistoricalRevenue,
        },
        tickets: {
          openTicketsCount,
          installationTicketsCount,
          faultTicketsCount,
          maintenanceTicketsCount,
        },
        inventory: {
          lowStockCount,
          lowStockItems: lowStockProducts.map((p) => ({
            id: p.id,
            sku: p.sku,
            name: p.name,
            brand: p.brand,
            model: p.model,
            stockCurrent: p.stockCurrent,
            stockMinimum: p.stockMinimum,
          })),
          technicianCustodyCount,
          staleTechnicianEquipmentCount: staleTechnicianEquipment.length,
          staleTechnicianEquipment: staleTechnicianEquipment.map((s) => ({
            id: s.id,
            serialNumber: s.serialNumber,
            productName: s.product?.name || 'Equipo',
            technicianName: s.currentEmployee?.user?.username || 'Técnico',
            daysWithTechnician: s.lastMovementAt
              ? Math.floor((Date.now() - new Date(s.lastMovementAt).getTime()) / (1000 * 60 * 60 * 24))
              : null,
          })),
        },
        recentTickets: recentTickets.map((t) => ({
          id: t.id,
          ticketNumber: t.ticketNumber,
          type: t.type,
          priority: t.priority,
          status: t.status,
          title: t.title,
          createdAt: t.createdAt,
          clientName: t.client?.name || 'Cliente General',
          sector: t.contract?.address?.sector || 'Zona Metropolitana',
          planName: t.contract?.plan?.name || 'Plan Estándar',
          assignedTo: t.assignedEmployee?.user?.username || null,
        })),
        dgii: {
          status: 'CONNECTED',
          totalInvoices,
          acceptedInvoices,
        },
      };
    } catch (error) {
      console.error('Error in DashboardService.getSummary:', error);
      return {
        subscribers: { totalClients: 0, activeContractsCount: 0, pendingContractsCount: 0, growthPercentage: 0 },
        revenue: { todayRevenue: 0, todaySalesCount: 0, todayInvoicesCount: 0, totalHistoricalRevenue: 0 },
        tickets: { openTicketsCount: 0, installationTicketsCount: 0, faultTicketsCount: 0, maintenanceTicketsCount: 0 },
        inventory: {
          lowStockCount: 0,
          lowStockItems: [],
          technicianCustodyCount: 0,
          staleTechnicianEquipmentCount: 0,
          staleTechnicianEquipment: [],
        },
        recentTickets: [],
        dgii: { status: 'CONNECTED', totalInvoices: 0, acceptedInvoices: 0 },
      };
    }
  }

  async getRevenueTrend(days = 7) {
    try {
      const timeZone = await this.getTenantTimezone();
      const now = new Date();
      const dates: string[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        dates.push(dateKeyInTimezone(d, timeZone));
      }

      let sales: SaleEntity[] = [];
      try {
        sales = await this.saleRepository.find({
          where: { status: 'PAID' },
          order: { createdAt: 'ASC' },
        });
      } catch {
        sales = [];
      }

      const trend = dates.map((dateStr) => {
        const daySales = sales.filter((s) => {
          if (!s.createdAt) return false;
          const d = new Date(s.createdAt);
          if (isNaN(d.getTime())) return false;
          return dateKeyInTimezone(d, timeZone) === dateStr;
        });
        const total = daySales.reduce((acc, s) => acc + Number(s.grandTotal || 0), 0);
        return {
          date: dateStr,
          total,
          count: daySales.length,
        };
      });

      return trend;
    } catch (error) {
      console.error('Error in DashboardService.getRevenueTrend:', error);
      return [];
    }
  }
}
