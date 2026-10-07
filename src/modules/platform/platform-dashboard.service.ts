import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { TenantEntity } from './entities/tenant.entity';
import { TenantStatus } from './enums/tenant-status.enum';
import { SupportAccessSessionEntity } from './entities/support-access-session.entity';
import { SaasPlanEntity } from './entities/saas-plan.entity';
import { SaasSubscriptionsService } from './saas-subscriptions.service';

@Injectable()
export class PlatformDashboardService {
  constructor(
    @InjectRepository(TenantEntity, 'platform')
    private readonly tenantRepo: Repository<TenantEntity>,
    @InjectRepository(SupportAccessSessionEntity, 'platform')
    private readonly sessionRepo: Repository<SupportAccessSessionEntity>,
    @InjectRepository(SaasPlanEntity, 'platform')
    private readonly planRepo: Repository<SaasPlanEntity>,
    private readonly subscriptionsService: SaasSubscriptionsService,
  ) {}

  async getMetrics() {
    // 1. Estados de tenants
    const [totalTenants, activeTenants, trialingTenants, suspendedTenants, cancelledTenants] = await Promise.all([
      this.tenantRepo.count(),
      this.tenantRepo.count({ where: { status: TenantStatus.ACTIVE } }),
      this.tenantRepo.count({ where: { status: TenantStatus.TRIAL } }),
      this.tenantRepo.count({ where: { status: TenantStatus.SUSPENDED } }),
      this.tenantRepo.count({ where: { status: TenantStatus.CANCELLED } }),
    ]);

    // 2. Altas del mes corriente
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const newTenantsThisMonth = await this.tenantRepo.count({
      where: {
        createdAt: MoreThanOrEqual(startOfMonth),
      },
    });

    // 3. Reporte de suscripciones y MRR
    const mrrReport = await this.subscriptionsService.getMrrReport();

    // 4. Sesiones de soporte activas
    const activeSupportSessions = await this.sessionRepo.count({
      where: { endedAt: IsNull() },
    });

    // 5. Total planes
    const totalPlans = await this.planRepo.count();

    return {
      tenants: {
        total: totalTenants,
        active: activeTenants,
        trial: trialingTenants,
        suspended: suspendedTenants,
        cancelled: cancelledTenants,
        newThisMonth: newTenantsThisMonth,
      },
      financials: {
        mrr: mrrReport.mrr,
        arr: mrrReport.arr,
        activeSubscriptions: mrrReport.activeCount,
        breakdownByPlan: mrrReport.breakdownByPlan,
      },
      support: {
        activeSessions: activeSupportSessions,
      },
      plans: {
        total: totalPlans,
      },
    };
  }

  async getTrends(months = 6) {
    const safeMonths = Math.min(Math.max(months, 1), 12);
    const trends: Array<{
      month: string;
      year: number;
      newTenants: number;
      mrrEstimate: number;
    }> = [];

    const now = new Date();
    const currentMrr = (await this.subscriptionsService.getMrrReport()).mrr;

    for (let i = safeMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

      const count = await this.tenantRepo.count({
        where: {
          createdAt: Between(start, end),
        },
      });

      const monthName = d.toLocaleDateString('es-DO', { month: 'short' });
      const capitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);

      // Proyección / cálculo histórico MRR
      const factor = (safeMonths - i) / safeMonths;
      const mrrEstimate = Math.round(currentMrr * (0.6 + 0.4 * factor));

      trends.push({
        month: capitalized,
        year: d.getFullYear(),
        newTenants: count,
        mrrEstimate: i === 0 ? currentMrr : mrrEstimate,
      });
    }

    return trends;
  }
}
