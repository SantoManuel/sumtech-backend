import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SaasFeatureGuard } from '../../common/guards/saas-feature.guard';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { OltManagementService } from './services/olt-management.service';
import { OltCatalogsService } from './services/olt-catalogs.service';
import { OltNatManagerService } from './services/olt-nat-manager.service';
import { OltMonitoringService } from './services/olt-monitoring.service';
import { OltDriverRegistry } from './drivers/olt-driver.registry';
import { OltPermissionGuard, RequireOltAction } from './guards/olt-permission.guard';
import { CreateOltSpeedProfileDto, UpdateOltSpeedProfileDto } from './dto/speed-profile.dto';

@Controller('olt')
@UseGuards(AuthGuard, RolesGuard, SaasFeatureGuard, OltPermissionGuard)
@RequireFeature('OLT')
export class OltController {
  constructor(
    private readonly oltService: OltManagementService,
    private readonly catalogsService: OltCatalogsService,
    private readonly natService: OltNatManagerService,
    private readonly monitoringService: OltMonitoringService,
    private readonly driverRegistry: OltDriverRegistry,
  ) {}

  // ══════════════════════════════════════════════════
  // OLTs (RF-OLT-001/002/003/004/006/007)
  // ══════════════════════════════════════════════════
  @Get('olts')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  @RequireOltAction('VIEW')
  async findAllOlts(@Query('activeOnly') activeOnly?: string) {
    return this.oltService.findAll(activeOnly === 'true');
  }

  /**
   * Capacidades reales por fabricante (sin conectarse a ningún equipo) — el
   * frontend lo usa para mostrar qué tan soportado está cada vendor antes de
   * que el usuario cree una OLT.
   */
  @Get('vendors')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  async findAllVendorCapabilities() {
    return this.driverRegistry.listAll();
  }

  @Get('olts/:id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  @RequireOltAction('VIEW')
  async findOltById(@Param('id') id: string) {
    return this.oltService.findById(id);
  }

  @Post('olts')
  @Roles(Role.ADMIN, Role.GERENTE)
  @RequireOltAction('CONFIGURE')
  async createOlt(@Body() dto: any, @Req() req: any) {
    return this.oltService.create(dto, req.user?.id);
  }

  @Patch('olts/:id')
  @Roles(Role.ADMIN, Role.GERENTE)
  @RequireOltAction('CONFIGURE')
  async updateOlt(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.oltService.update(id, dto, req.user?.id);
  }

  @Post('olts/:id/test-connection')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('OPERATE')
  async testOltConnection(@Param('id') id: string) {
    return this.oltService.testConnection(id);
  }

  @Post('olts/:id/discover-interfaces')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('OPERATE')
  async discoverInterfaces(@Param('id') id: string, @Req() req: any) {
    return this.oltService.discoverInterfaces(id, req.user?.id);
  }

  @Post('olts/:id/nat-rule')
  @Roles(Role.ADMIN, Role.GERENTE)
  @RequireOltAction('CONFIGURE')
  async ensureNatRule(@Param('id') id: string, @Req() req: any) {
    return this.natService.ensureOltNatRule(id, req.user?.id);
  }

  @Get('olts/:id/telemetry')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('VIEW')
  async getOltTelemetry(@Param('id') id: string) {
    return this.monitoringService.getLatestMetrics(id);
  }

  @Post('olts/:id/telemetry/refresh')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('OPERATE')
  async refreshOltTelemetry(@Param('id') id: string) {
    return this.monitoringService.collectAndRecordMetrics(id);
  }

  @Get('olts/:id/metrics/history')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('VIEW')
  async getOltMetricsHistory(
    @Param('id') id: string,
    @Query('hours') hours?: number,
    @Query('days') days?: number,
  ) {
    const totalHours = days ? Number(days) * 24 : hours ? Number(hours) : 24;
    return this.monitoringService.getMetricsHistory(id, totalHours);
  }

  // ══════════════════════════════════════════════════
  // VLANs (RF-OLT-011 / RF-OLT-012)
  // ══════════════════════════════════════════════════
  @Get('vlans')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  async findAllVlans() {
    return this.catalogsService.findAllVlans();
  }

  @Post('vlans')
  @Roles(Role.ADMIN, Role.GERENTE)
  async createVlan(@Body() dto: any) {
    return this.catalogsService.createVlan(dto);
  }

  @Patch('vlans/:id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async updateVlan(@Param('id') id: string, @Body() dto: any) {
    return this.catalogsService.updateVlan(id, dto);
  }

  @Delete('vlans/:id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async deleteVlan(@Param('id') id: string) {
    return this.catalogsService.deleteVlan(id);
  }

  @Post('interfaces/:id/vlans')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async assignVlanToInterface(
    @Param('id') interfaceId: string,
    @Body() body: { vlanId: string; mode?: 'TAG' | 'UNTAG'; applyToHardware?: boolean },
  ) {
    return this.catalogsService.assignVlanToInterface(
      interfaceId,
      body.vlanId,
      body.mode || 'TAG',
      body.applyToHardware ?? false,
    );
  }

  @Post('interfaces/:id/admin-state')
  @Roles(Role.ADMIN, Role.GERENTE)
  async setInterfaceAdminState(@Param('id') interfaceId: string, @Body() body: { state: 'UP' | 'DOWN' }) {
    return this.catalogsService.setInterfaceAdminState(interfaceId, body.state);
  }

  @Post('olts/:oltId/speed-profiles/:profileId/sync')
  @Roles(Role.ADMIN, Role.GERENTE)
  async syncSpeedProfileToOlt(@Param('oltId') oltId: string, @Param('profileId') profileId: string) {
    return this.catalogsService.syncSpeedProfileToOlt(oltId, profileId);
  }

  // ══════════════════════════════════════════════════
  // Perfiles de Velocidad OLT (RF-OLT-008)
  // ══════════════════════════════════════════════════
  @Get('speed-profiles')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  async findAllSpeedProfiles() {
    return this.catalogsService.findAllSpeedProfiles();
  }

  @Get('speed-profiles/:id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  async findSpeedProfileById(@Param('id') id: string) {
    return this.catalogsService.findSpeedProfileById(id);
  }

  @Post('speed-profiles')
  @Roles(Role.ADMIN, Role.GERENTE)
  async createSpeedProfile(@Body() dto: CreateOltSpeedProfileDto) {
    return this.catalogsService.createSpeedProfile(dto);
  }

  @Patch('speed-profiles/:id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async updateSpeedProfile(@Param('id') id: string, @Body() dto: UpdateOltSpeedProfileDto) {
    return this.catalogsService.updateSpeedProfile(id, dto);
  }

  @Delete('speed-profiles/:id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async deleteSpeedProfile(@Param('id') id: string) {
    return this.catalogsService.deleteSpeedProfile(id);
  }

  // ══════════════════════════════════════════════════
  // Tipos de ONU (RF-OLT-010)
  // ══════════════════════════════════════════════════
  @Get('onu-types')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  async findAllOnuTypes(@Query('ponType') ponType?: string) {
    return this.catalogsService.findAllOnuTypes(ponType);
  }

  @Post('onu-types')
  @Roles(Role.ADMIN, Role.GERENTE)
  async createOnuType(@Body() dto: any) {
    return this.catalogsService.createOnuType(dto);
  }

  // ══════════════════════════════════════════════════
  // Redes TR-069 (RF-OLT-013)
  // ══════════════════════════════════════════════════
  @Get('tr069-networks')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  async findAllTr069Networks() {
    return this.catalogsService.findAllTr069Networks();
  }

  @Post('tr069-networks')
  @Roles(Role.ADMIN, Role.GERENTE)
  async createTr069Network(@Body() dto: any) {
    return this.catalogsService.createTr069Network(dto);
  }
}
