import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { PlatformRolesGuard } from './guards/platform-roles.guard';
import { platformEntities } from '../../config/platform-database.config';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantsController } from './tenants.controller';
import { PlatformTenantsService } from './platform-tenants.service';
import { SaasPlansService } from './saas-plans.service';
import { SaasPlansController } from './saas-plans.controller';
import { SaasSubscriptionsService } from './saas-subscriptions.service';
import { SaasSubscriptionsController } from './saas-subscriptions.controller';
import { SupportAccessService } from './support-access.service';
import { SupportAccessController } from './support-access.controller';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformDashboardController } from './platform-dashboard.controller';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuditLogsController } from './platform-audit-logs.controller';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    // Conexión nombrada 'platform' (ver app.module.ts) — separada de la
    // conexión 'default' de tenants.
    TypeOrmModule.forFeature(platformEntities, 'platform'),
    MailModule,
  ],
  controllers: [
    PlatformAuthController,
    TenantsController,
    SaasPlansController,
    SaasSubscriptionsController,
    SupportAccessController,
    PlatformDashboardController,
    PlatformAuditLogsController,
  ],
  providers: [
    PlatformAuthService,
    PlatformAuthGuard,
    PlatformRolesGuard,
    TenantProvisioningService,
    PlatformAuditService,
    PlatformTenantsService,
    SaasPlansService,
    SaasSubscriptionsService,
    SupportAccessService,
    PlatformDashboardService,
  ],
  exports: [
    PlatformAuthService,
    PlatformAuthGuard,
    PlatformRolesGuard,
    PlatformAuditService,
    PlatformTenantsService,
    SaasPlansService,
    SaasSubscriptionsService,
    SupportAccessService,
    PlatformDashboardService,
  ],
})
export class PlatformModule {}
