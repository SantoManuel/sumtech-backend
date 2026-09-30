import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { PlatformTenantsService } from './platform-tenants.service';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { QueryTenantsDto } from './dto/query-tenants.dto';
import { SuspendTenantDto } from './dto/suspend-tenant.dto';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { PlatformRolesGuard } from './guards/platform-roles.guard';
import { PlatformRoles } from './decorators/platform-roles.decorator';
import { PlatformRole } from './enums/platform-role.enum';
import { CurrentPlatformUser } from './decorators/current-platform-user.decorator';
import { PlatformJwtPayload } from './interfaces/platform-jwt-payload.interface';
import { TenantConnectionManagerService } from '../../common/tenancy/tenant-connection-manager.service';
import { CompanyProfileEntity } from '../company/entities/company-profile.entity';

@Controller('platform/tenants')
export class TenantsController {
  constructor(
    private readonly tenantProvisioningService: TenantProvisioningService,
    private readonly platformTenantsService: PlatformTenantsService,
    private readonly connectionManager: TenantConnectionManagerService,
  ) {}

  // Listar todos los tenants con filtros (SuperAdmin o Support)
  @Get()
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN, PlatformRole.SUPPORT)
  async findAll(@Query() query: QueryTenantsDto) {
    return this.platformTenantsService.findAll(query);
  }

  // Detalle de un tenant con estadísticas (SuperAdmin o Support)
  @Get(':id')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN, PlatformRole.SUPPORT)
  async findOne(@Param('id') id: string) {
    return this.platformTenantsService.findOne(id);
  }

  // Diagnóstico de salud operativa de la DB del tenant (SuperAdmin o Support)
  @Get(':id/health')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN, PlatformRole.SUPPORT)
  async getHealth(@Param('id') id: string) {
    return this.platformTenantsService.getTenantHealth(id);
  }

  // Suspender un tenant (Solo SuperAdmin)
  @Post(':id/suspend')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  async suspend(
    @Param('id') id: string,
    @Body() dto: SuspendTenantDto,
    @CurrentPlatformUser() admin: PlatformJwtPayload,
    @Req() req: any,
  ) {
    const ip = req.ip || req.connection?.remoteAddress;
    return this.platformTenantsService.suspend(id, dto, admin.sub, ip);
  }

  // Reactivar un tenant suspendido (Solo SuperAdmin)
  @Post(':id/reactivate')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  async reactivate(
    @Param('id') id: string,
    @CurrentPlatformUser() admin: PlatformJwtPayload,
    @Req() req: any,
  ) {
    const ip = req.ip || req.connection?.remoteAddress;
    return this.platformTenantsService.reactivate(id, admin.sub, ip);
  }

  // Público — usado por el sitio de venta del SaaS (Fase 7, "Crear mi empresa").
  // No pasa por TenantResolutionMiddleware (platform/* está excluido) ni por
  // ningún guard: cualquiera puede registrar un tenant nuevo.
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterTenantDto) {
    return this.tenantProvisioningService.provision(dto);
  }

  // Alta manual del SuperAdmin — mismo servicio subyacente que el registro
  // público, solo cambia quién puede invocarlo.
  @Post()
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: RegisterTenantDto) {
    return this.tenantProvisioningService.provision(dto);
  }

  // Público, sin contexto de subdominio — usado por el sitio de venta del
  // SaaS (Fase 7) y por cualquier pantalla de pre-login que necesite
  // nombre/logo/color de un tenant antes de que TenantResolutionMiddleware
  // pueda resolverlo (ese middleware solo corre bajo /api/v1/*, no /platform/*).
  @Get('by-slug/:slug/public-info')
  async getPublicInfo(@Param('slug') slug: string) {
    const tenant = await this.connectionManager.resolveTenantBySlug(slug.toLowerCase());
    if (!tenant) {
      throw new NotFoundException(`No existe ningún tenant con el identificador "${slug}".`);
    }

    let logoUrl: string | undefined;
    let primaryColor: string | undefined;
    try {
      const tenantDataSource = await this.connectionManager.getDataSourceForTenant(tenant);
      const profile = await tenantDataSource.getRepository(CompanyProfileEntity).findOne({ where: {} });
      logoUrl = profile?.logoUrl;
      primaryColor = (profile?.siteContent as any)?.primaryColor;
    } catch {
      // Sin bloquear la respuesta si la DB del tenant no está disponible en
      // este momento — el caller igual necesita saber que el tenant existe.
    }

    return {
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      logoUrl,
      primaryColor,
    };
  }
}
