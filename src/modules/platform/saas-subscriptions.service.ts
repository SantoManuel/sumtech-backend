import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SaasSubscriptionEntity } from './entities/saas-subscription.entity';
import { SaasSubscriptionStatus } from './enums/saas-subscription-status.enum';
import { TenantEntity } from './entities/tenant.entity';
import { SaasPlanEntity } from './entities/saas-plan.entity';
import { PlatformAuditService } from './platform-audit.service';
import { ChangeSaasSubscriptionPlanDto } from './dto/change-saas-subscription-plan.dto';
import { UpdateSaasSubscriptionStatusDto } from './dto/update-saas-subscription-status.dto';
import { RecordManualPaymentDto } from './dto/record-manual-payment.dto';
import { ExtendSaasTrialDto } from './dto/extend-saas-trial.dto';

@Injectable()
export class SaasSubscriptionsService {
  constructor(
    @InjectRepository(SaasSubscriptionEntity, 'platform')
    private readonly subRepo: Repository<SaasSubscriptionEntity>,
    @InjectRepository(TenantEntity, 'platform')
    private readonly tenantRepo: Repository<TenantEntity>,
    @InjectRepository(SaasPlanEntity, 'platform')
    private readonly planRepo: Repository<SaasPlanEntity>,
    private readonly auditService: PlatformAuditService,
  ) {}

  async findAll(params?: { limit?: number; offset?: number; page?: number }) {
    if (!params?.limit) {
      return this.subRepo.find({
        relations: ['tenant', 'plan'],
        order: { createdAt: 'DESC' },
      });
    }

    const take = params.limit;
    const skip = params.offset ?? ((params.page ? params.page - 1 : 0) * take);
    const [items, total] = await this.subRepo.findAndCount({
      relations: ['tenant', 'plan'],
      order: { createdAt: 'DESC' },
      take,
      skip,
    });

    return { items, total, limit: take, offset: skip };
  }

  async findOne(id: string) {
    const sub = await this.subRepo.findOne({
      where: { id },
      relations: ['tenant', 'plan'],
    });

    if (!sub) {
      throw new NotFoundException(`Suscripción con ID "${id}" no encontrada`);
    }

    return sub;
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

  async changePlan(
    id: string,
    dto: ChangeSaasSubscriptionPlanDto,
    adminId?: string,
    ip?: string,
  ) {
    const sub = await this.findOne(id);
    const plan = await this.planRepo.findOne({ where: { id: dto.planId } });
    if (!plan) {
      throw new NotFoundException(`Plan SaaS con ID "${dto.planId}" no encontrado`);
    }

    const previousPlanId = sub.planId;
    sub.planId = plan.id;
    sub.plan = plan;

    if (sub.tenantId) {
      await this.tenantRepo.update(sub.tenantId, { planId: plan.id });
    }

    const saved = await this.subRepo.save(sub);

    await this.auditService.log({
      action: 'SAAS_SUBSCRIPTION_PLAN_CHANGED',
      entity: 'SaasSubscription',
      entityId: saved.id,
      platformUserId: adminId,
      metadata: {
        previousPlanId,
        newPlanId: plan.id,
        planName: plan.name,
        reason: dto.reason,
      },
      ipAddress: ip,
    });

    return this.findOne(id);
  }

  async updateStatus(
    id: string,
    dto: UpdateSaasSubscriptionStatusDto,
    adminId?: string,
    ip?: string,
  ) {
    const sub = await this.findOne(id);
    const previousStatus = sub.status;
    sub.status = dto.status;

    if (dto.reason) {
      const noteEntry = `[${new Date().toLocaleDateString('es-DO')}] Cambio de estado a ${dto.status}: ${dto.reason}`;
      sub.billingNotes = sub.billingNotes ? `${sub.billingNotes}\n${noteEntry}` : noteEntry;
    }

    const saved = await this.subRepo.save(sub);

    await this.auditService.log({
      action: 'SAAS_SUBSCRIPTION_STATUS_CHANGED',
      entity: 'SaasSubscription',
      entityId: saved.id,
      platformUserId: adminId,
      metadata: {
        previousStatus,
        newStatus: dto.status,
        reason: dto.reason,
      },
      ipAddress: ip,
    });

    return this.findOne(id);
  }

  async recordManualPayment(
    id: string,
    dto: RecordManualPaymentDto,
    adminId?: string,
    ip?: string,
  ) {
    const sub = await this.findOne(id);
    const months = dto.monthsToAdd && dto.monthsToAdd > 0 ? dto.monthsToAdd : 1;

    const baseDate =
      sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > new Date()
        ? new Date(sub.currentPeriodEnd)
        : new Date();

    const newEnd = new Date(baseDate);
    newEnd.setMonth(newEnd.getMonth() + months);

    sub.currentPeriodEnd = newEnd;
    sub.status = SaasSubscriptionStatus.ACTIVE;
    sub.lastPaymentDate = new Date();

    const noteEntry = `[${new Date().toLocaleDateString('es-DO')}] Pago manual de ${months} mes(es). Ref: ${dto.paymentReference}${dto.amountPaid !== undefined ? ` - Monto: $${dto.amountPaid}` : ''}${dto.notes ? ` - Nota: ${dto.notes}` : ''}`;
    sub.billingNotes = sub.billingNotes ? `${sub.billingNotes}\n${noteEntry}` : noteEntry;

    const saved = await this.subRepo.save(sub);

    await this.auditService.log({
      action: 'SAAS_SUBSCRIPTION_PAYMENT_RECORDED',
      entity: 'SaasSubscription',
      entityId: saved.id,
      platformUserId: adminId,
      metadata: {
        monthsAdded: months,
        reference: dto.paymentReference,
        amount: dto.amountPaid,
        newPeriodEnd: newEnd,
      },
      ipAddress: ip,
    });

    return this.findOne(id);
  }

  async extendTrial(
    id: string,
    dto: ExtendSaasTrialDto,
    adminId?: string,
    ip?: string,
  ) {
    const sub = await this.findOne(id);
    const days = dto.daysToAdd && dto.daysToAdd > 0 ? dto.daysToAdd : 14;

    const baseDate =
      sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > new Date()
        ? new Date(sub.currentPeriodEnd)
        : new Date();

    const newEnd = new Date(baseDate);
    newEnd.setDate(newEnd.getDate() + days);

    sub.currentPeriodEnd = newEnd;
    sub.trialEndsAt = newEnd;
    sub.status = SaasSubscriptionStatus.TRIALING;

    const noteEntry = `[${new Date().toLocaleDateString('es-DO')}] Trial extendido por ${days} días.${dto.reason ? ` Motivo: ${dto.reason}` : ''}`;
    sub.billingNotes = sub.billingNotes ? `${sub.billingNotes}\n${noteEntry}` : noteEntry;

    const saved = await this.subRepo.save(sub);

    await this.auditService.log({
      action: 'SAAS_SUBSCRIPTION_TRIAL_EXTENDED',
      entity: 'SaasSubscription',
      entityId: saved.id,
      platformUserId: adminId,
      metadata: {
        daysAdded: days,
        newPeriodEnd: newEnd,
        reason: dto.reason,
      },
      ipAddress: ip,
    });

    return this.findOne(id);
  }

  async syncMissingSubscriptions() {
    const tenants = await this.tenantRepo.find();
    let syncedCount = 0;

    const defaultPlan = await this.planRepo.findOne({
      where: { isActive: true },
      order: { monthlyPrice: 'ASC' },
    });

    for (const tenant of tenants) {
      const existing = await this.subRepo.findOne({ where: { tenantId: tenant.id } });
      if (!existing) {
        const planId = tenant.planId || defaultPlan?.id;
        if (planId) {
          const isTrial = tenant.status === 'TRIAL';
          const periodEnd = new Date();
          periodEnd.setDate(periodEnd.getDate() + (isTrial ? 14 : 30));

          await this.subRepo.save(
            this.subRepo.create({
              tenantId: tenant.id,
              planId,
              status: isTrial ? SaasSubscriptionStatus.TRIALING : SaasSubscriptionStatus.ACTIVE,
              currentPeriodEnd: periodEnd,
              trialEndsAt: isTrial ? periodEnd : undefined,
              billingNotes: 'Suscripción auto-sincronizada para inquilino existente.',
            }),
          );
          syncedCount++;
        }
      }
    }

    return {
      message: `Sincronización completada. Se generaron ${syncedCount} suscripciones faltantes.`,
      syncedCount,
    };
  }
}
