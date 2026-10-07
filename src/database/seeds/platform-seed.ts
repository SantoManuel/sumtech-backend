import * as dotenv from 'dotenv';
dotenv.config();

import * as bcrypt from 'bcrypt';
import { PlatformDataSource } from '../../config/platform-database.config';
import { PlatformUserEntity } from '../../modules/platform/entities/platform-user.entity';
import { PlatformRole } from '../../modules/platform/enums/platform-role.enum';

import { TenantEntity } from '../../modules/platform/entities/tenant.entity';
import { SaasPlanEntity } from '../../modules/platform/entities/saas-plan.entity';
import { SaasSubscriptionEntity } from '../../modules/platform/entities/saas-subscription.entity';
import { SaasSubscriptionStatus } from '../../modules/platform/enums/saas-subscription-status.enum';
import { TenantStatus } from '../../modules/platform/enums/tenant-status.enum';

const SEED_USERS = [
  {
    email: 'superadmin@sumtech.com',
    role: PlatformRole.SUPERADMIN,
    password: process.env.PLATFORM_SEED_PASSWORD || 'password123',
  },
  {
    email: 'superadmin@sumtech.do',
    role: process.env.PLATFORM_SEED_EMAIL ? PlatformRole.SUPERADMIN : PlatformRole.SUPERADMIN,
    password: process.env.PLATFORM_SEED_PASSWORD || 'password123',
  },
  {
    email: 'support@sumtech.com',
    role: PlatformRole.SUPPORT,
    password: process.env.PLATFORM_SEED_PASSWORD || 'password123',
  },
  {
    email: 'support@sumtech.do',
    role: PlatformRole.SUPPORT,
    password: process.env.PLATFORM_SEED_PASSWORD || 'password123',
  },
];

const SEED_PLANS = [
  {
    name: 'Plan Enterprise',
    monthlyPrice: 199.0,
    maxUsers: 100,
    maxClients: 10000,
    features: { dgii: true, mikrotik: true, olt: true, chatbot: true, billing: true },
    isActive: true,
  },
  {
    name: 'Plan Profesional',
    monthlyPrice: 99.0,
    maxUsers: 25,
    maxClients: 2500,
    features: { dgii: true, mikrotik: true, olt: true, chatbot: false, billing: true },
    isActive: true,
  },
];

const SEED_TENANTS = [
  {
    name: 'Sumtech Telecomunicaciones, S.R.L.',
    slug: 'sumtech',
    dbName: process.env.DB_DATABASE || 'sumtech_erp',
    status: TenantStatus.ACTIVE,
    rnc: '131000000',
  },
  {
    name: 'ISP Azua Telecom, S.R.L.',
    slug: 'ispazua',
    dbName: 'tenant_ispazua',
    status: TenantStatus.ACTIVE,
    rnc: '132000000',
  },
  {
    name: 'Demo Telecomunicaciones',
    slug: 'demo',
    dbName: 'tenant_demo',
    status: TenantStatus.ACTIVE,
    rnc: '133000000',
  },
];

export async function runPlatformSeed() {
  console.log('🌱 ==============================================================================');
  console.log('🌱 SEMILLERO DE PLATAFORMA SAAS (SuperAdmins, Planes y Tenants)');
  console.log('🌱 ==============================================================================');

  if (!PlatformDataSource.isInitialized) {
    await PlatformDataSource.initialize();
  }

  // 1. Sembrar Planes SaaS
  const planRepo = PlatformDataSource.getRepository(SaasPlanEntity);
  let defaultPlan: SaasPlanEntity | null = null;
  for (const p of SEED_PLANS) {
    let existingPlan = await planRepo.findOneBy({ name: p.name });
    if (!existingPlan) {
      existingPlan = await planRepo.save(planRepo.create(p));
      console.log(`✅ Plan SaaS creado: ${p.name}`);
    } else {
      console.log(`ℹ️  Plan SaaS existente: ${p.name}`);
    }
    if (!defaultPlan) defaultPlan = existingPlan;
  }

  // 2. Sembrar Tenants (Inquilinos) y sus Suscripciones SaaS
  const tenantRepo = PlatformDataSource.getRepository(TenantEntity);
  const subRepo = PlatformDataSource.getRepository(SaasSubscriptionEntity);

  const planEnterprise = await planRepo.findOneBy({ name: 'Plan Enterprise' });
  const planProfesional = await planRepo.findOneBy({ name: 'Plan Profesional' });

  for (const t of SEED_TENANTS) {
    const assignedPlan = t.slug === 'sumtech' ? planEnterprise : (planProfesional || defaultPlan);
    let existingTenant = await tenantRepo.findOneBy({ slug: t.slug });
    if (!existingTenant) {
      existingTenant = await tenantRepo.save(
        tenantRepo.create({
          name: t.name,
          slug: t.slug,
          dbName: t.dbName,
          status: t.status,
          rnc: t.rnc,
          planId: assignedPlan?.id,
        }),
      );
      console.log(`✅ Tenant SaaS creado: ${t.name} (Subdominio: ${t.slug} -> DB: ${t.dbName})`);
    } else {
      existingTenant.status = t.status;
      existingTenant.dbName = t.dbName;
      if (assignedPlan) existingTenant.planId = assignedPlan.id;
      await tenantRepo.save(existingTenant);
      console.log(`ℹ️  Tenant SaaS actualizado: ${t.name} (Subdominio: ${t.slug} -> DB: ${t.dbName})`);
    }

    // Sembrar o sincronizar suscripción de este tenant
    let existingSub = await subRepo.findOne({ where: { tenantId: existingTenant.id } });
    const isSumtechOrIsp = t.slug === 'sumtech' || t.slug === 'ispazua';
    const subStatus = isSumtechOrIsp ? SaasSubscriptionStatus.ACTIVE : SaasSubscriptionStatus.TRIALING;
    const renewalDays = t.slug === 'sumtech' ? 30 : t.slug === 'ispazua' ? 20 : 7;
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + renewalDays);

    if (!existingSub) {
      if (assignedPlan) {
        await subRepo.save(
          subRepo.create({
            tenantId: existingTenant.id,
            planId: assignedPlan.id,
            status: subStatus,
            currentPeriodEnd: periodEnd,
            trialEndsAt: isSumtechOrIsp ? undefined : periodEnd,
            billingNotes: `Suscripción sembrada automáticamente (${assignedPlan.name}).`,
          }),
        );
        console.log(`✅ Suscripción creada para ${t.name}: Estado ${subStatus}, Plan ${assignedPlan.name}`);
      }
    } else {
      existingSub.planId = assignedPlan?.id || existingSub.planId;
      existingSub.status = subStatus;
      existingSub.currentPeriodEnd = periodEnd;
      await subRepo.save(existingSub);
      console.log(`ℹ️  Suscripción actualizada para ${t.name}: Estado ${subStatus}`);
    }
  }

  // 3. Sembrar Usuarios de Plataforma (SuperAdmin / Soporte)
  const platformUserRepo = PlatformDataSource.getRepository(PlatformUserEntity);
  for (const userDef of SEED_USERS) {
    const existing = await platformUserRepo.findOneBy({ email: userDef.email });
    const passwordHash = await bcrypt.hash(userDef.password, 10);

    if (existing) {
      existing.passwordHash = passwordHash;
      existing.isActive = true;
      existing.role = userDef.role;
      await platformUserRepo.save(existing);
      console.log(`ℹ️  Usuario de plataforma actualizado: ${userDef.email} (${userDef.role})`);
    } else {
      await platformUserRepo.save(
        platformUserRepo.create({
          email: userDef.email,
          passwordHash,
          role: userDef.role,
          isActive: true,
        }),
      );
      console.log(`✅ Usuario de plataforma creado: ${userDef.email} (${userDef.role})`);
    }
  }
  console.log('✅ Semillero de plataforma SaaS finalizado exitosamente.');
}

if (require.main === module) {
  runPlatformSeed()
    .then(() => PlatformDataSource.destroy())
    .catch((err) => {
      console.error('❌ Error ejecutando el seed de plataforma:', err);
      process.exit(1);
    });
}
