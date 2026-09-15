import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CompanyService } from './company.service';
import { CreateTenantConfigDto } from './dto/create-tenant-config.dto';
import { UpdateTenantConfigDto } from './dto/update-tenant-config.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@Controller('company')
@UseGuards(AuthGuard, RolesGuard)
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  /**
   * Endpoint principal simplificado: Obtiene la configuración de la empresa actual / predeterminada
   */
  @Get('config')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO)
  async getConfig() {
    return this.companyService.getDefaultTenant();
  }

  /**
   * Endpoint principal simplificado: Actualiza la configuración de la empresa predeterminada
   */
  @Put('config')
  @Roles(Role.ADMIN)
  async updateConfig(@Body() dto: UpdateTenantConfigDto) {
    const defaultTenant = await this.companyService.getDefaultTenant();
    return this.companyService.update(defaultTenant.id, dto);
  }

  /**
   * Multi-Tenant: Lista todas las empresas / sucursales registradas
   */
  @Get('tenants')
  @Roles(Role.ADMIN, Role.GERENTE)
  async listTenants(@Query('activeOnly') activeOnly?: string) {
    return this.companyService.findAll(activeOnly === 'true');
  }

  /**
   * Multi-Tenant: Obtiene la empresa activa por defecto
   */
  @Get('tenants/default')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO)
  async getDefaultTenant() {
    return this.companyService.getDefaultTenant();
  }

  /**
   * Multi-Tenant: Obtiene el perfil de una empresa por su UUID
   */
  @Get('tenants/:id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getTenantById(@Param('id', ParseUUIDPipe) id: string) {
    return this.companyService.findById(id);
  }

  /**
   * Multi-Tenant: Crea una nueva empresa / sucursal
   */
  @Post('tenants')
  @Roles(Role.ADMIN)
  async createTenant(@Body() dto: CreateTenantConfigDto) {
    return this.companyService.create(dto);
  }

  /**
   * Multi-Tenant: Actualiza los parámetros de una empresa específica
   */
  @Put('tenants/:id')
  @Roles(Role.ADMIN)
  async updateTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantConfigDto,
  ) {
    return this.companyService.update(id, dto);
  }

  /**
   * Multi-Tenant: Marca una empresa como la predeterminada del ERP
   */
  @Patch('tenants/:id/set-default')
  @Roles(Role.ADMIN)
  async setDefaultTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.companyService.setDefault(id);
  }
}
