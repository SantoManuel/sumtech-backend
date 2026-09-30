import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SaasSubscriptionEntity } from './entities/saas-subscription.entity';
import { SaasSubscriptionStatus } from './enums/saas-subscription-status.enum';

@Injectable()
export class SaasSubscriptionsService {
  constructor(
    @InjectRepository(SaasSubscriptionEntity, 'platform')
    private readonly subRepo: Repository<SaasSubscriptionEntity>,
  ) {}

  async findAll() {
    return this.subRepo.find({
      relations: ['tenant', 'plan'],
      order: { createdAt: 'DESC' },
    });
  }

  async getMrrReport() {
    const subs = await this.subRepo.find({
      relations: ['plan', 'tenant'],
    });

    let mrr = 0;
    let activeCount = 0;
    let trialingCount = 0;
    let pastDueCount = 0;
    let cancelledCount = 0;

    const breakdownByPlan: Record<string, { planName: string; count: number; totalMonthly: number }> = {};

    for (const sub of subs) {
      if (sub.status === SaasSubscriptionStatus.ACTIVE) {
        activeCount++;
        const price = Number(sub.plan?.monthlyPrice || 0);
        mrr += price;

        const planName = sub.plan?.name || 'Sin Plan';
        if (!breakdownByPlan[planName]) {
          breakdownByPlan[planName] = { planName, count: 0, totalMonthly: 0 };
        }
        breakdownByPlan[planName].count++;
        breakdownByPlan[planName].totalMonthly += price;
      } else if (sub.status === SaasSubscriptionStatus.TRIALING) {
        trialingCount++;
      } else if (sub.status === SaasSubscriptionStatus.PAST_DUE) {
        pastDueCount++;
      } else if (sub.status === SaasSubscriptionStatus.CANCELED) {
        cancelledCount++;
      }
    }

    // Asegurar 2 decimales
    mrr = Math.round(mrr * 100) / 100;
    const arr = Math.round(mrr * 12 * 100) / 100;

    return {
      mrr,
      arr,
      totalSubscriptions: subs.length,
      activeCount,
      trialingCount,
      pastDueCount,
      cancelledCount,
      breakdownByPlan: Object.values(breakdownByPlan),
    };
  }
}
