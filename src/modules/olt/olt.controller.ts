import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Response } from 'express';
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
import { OltExportService } from './services/olt-export.service';
import { OltDriverRegistry } from './drivers/olt-driver.registry';
import { OltPermissionGuard, RequireOltAction } from './guards/olt-permission.guard';
import { CreateOltSpeedProfileDto, UpdateOltSpeedProfileDto } from './dto/speed-profile.dto';
import { CreateOnuTypeDto, UpdateOnuTypeDto } from './dto/onu-type.dto';
import { CreateTr069NetworkDto } from './dto/create-tr069-network.dto';
import { UpdateTr069NetworkDto } from './dto/update-tr069-network.dto';
import { ExportOltsDto } from './dto/export-olts.dto';
import { ListOltsDto } from './dto/list-olts.dto';
import { RunOltConsoleCommandDto } from './dto/run-olt-console-command.dto';

@Controller('olt')
@UseGuards(AuthGuard, RolesGuard, SaasFeatureGuard, OltPermissionGuard)
@RequireFeature('OLT')
export class OltController {
  constructor(
    private readonly oltService: OltManagementService,
    private readonly catalogsService: OltCatalogsService,
    private readonly natService: OltNatManagerService,
    private readonly monitoringService: OltMonitoringService,
    private readonly oltExportService: OltExportService,
    private readonly driverRegistry: OltDriverRegistry,
  ) {}

  // ══════════════════════════════════════════════════
  // OLTs (RF-OLT-001/002/003/004/006/007)
  // ══════════════════════════════════════════════════
  @Get('olts')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  @RequireOltAction('VIEW')
  async findAllOlts(@Query() dto: ListOltsDto) {
    return this.oltService.findAll(dto);
  }

  // Debe declararse antes de 'olts/:id' — mismo motivo que en ClientsController.
  // Sin @RequireOltAction: solo ADMIN/GERENTE pueden exportar (ver @Roles), y
  // ese rol ya pasa libre el OltPermissionGuard sin necesidad del decorator.
  @Get('olts/export')
  @Roles(Role.ADMIN, Role.GERENTE)
  async exportOlts(@Query() dto: ExportOltsDto, @Res() res: Response) {
    const result = await this.oltExportService.export(dto);
    res.set({
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length': result.buffer.length,
    });
    res.end(result.buffer);
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

  @Get('olts/:id/backup/download')
  @Roles(Role.ADMIN, Role.GERENTE)
  @RequireOltAction('VIEW')
  async downloadOltBackup(
    @Param('id') id: string,
    @Res() res: Response,
    @Req() req: any,
  ) {
    const result = await this.oltService.generateBackup(id, req.user?.id);
    res.set({
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length': result.buffer.length,
    });
    res.end(result.buffer);
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

  // Consola OLT (solo ADMIN) -- shell Telnet real y sin restricciones, mismo
  // alcance que la Consola RouterOS. Sin @RequireOltAction: ADMIN ya pasa
  // libre el OltPermissionGuard sin necesidad del decorator (ver exportOlts).
  @Post('olts/:id/console')
  @Roles(Role.ADMIN)
  async runOltConsoleCommand(@Param('id') id: string, @Body() dto: RunOltConsoleCommandDto, @Req() req: any) {
    return this.oltService.runRawCommand(id, dto.command, req.user?.id);
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

  @Get('olts/:id/interfaces/:name/traffic')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('VIEW')
  async getInterfaceTraffic(
    @Param('id') id: string,
    @Param('name') name: string,
  ) {
    return this.monitoringService.getInterfaceRealtimeTraffic(id, name);
  }

  @Post('telegram/test-alert')
  @Roles(Role.ADMIN, Role.GERENTE)
  async sendTestTelegramAlert() {
    return this.monitoringService.sendTestTelegramAlert();
  }

  // ══════════════════════════════════════════════════
  // VLANs (RF-OLT-011 / RF-OLT-012)
  // ══════════════════════════════════════════════════
  @Get('vlans')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  async findAllVlans() {
    return this.catalogsService.findAllVlans();
  }

  /**
   * VLANs REALES de una OLT puntual (ver `getVlansForOlt`) -- usar esta, NO
   * `GET /olt/vlans`, para selectores de aprovisionamiento como "VLAN de
   * Servicio" en OnuAuthorizeModal. Bug real confirmado (2026-10-30): el
   * modal mostraba TODAS las VLANs del tenant sin filtrar por OLT.
   */
  @Get('olts/:id/vlans')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  async findVlansForOlt(@Param('id') id: string) {
    return this.catalogsService.getVlansForOlt(id);
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

  /** Descubrimiento brownfield: VLANs que YA están tageadas/untagged en la OLT real para esta interfaz. Solo lectura. */
  @Get('interfaces/:id/vlans/scan')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async scanInterfaceRealVlans(@Param('id') interfaceId: string) {
    return this.catalogsService.scanRealInterfaceVlans(interfaceId);
  }

  /** Da de alta en Sumtech una VLAN descubierta por /vlans/scan -- no escribe nada en la OLT, ya existía. */
  @Post('interfaces/:id/vlans/import')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async importInterfaceDiscoveredVlan(
    @Param('id') interfaceId: string,
    @Body() body: { vlanId: number; mode: 'TAG' | 'UNTAG'; type?: 'INTERNET' | 'IPTV' | 'MGMT' | 'TR069' | 'VOIP' },
  ) {
    return this.catalogsService.importDiscoveredInterfaceVlan(interfaceId, body);
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

  /** Descubrimiento brownfield: perfiles TCONT que YA existen en la OLT real. Solo lectura. */
  @Get('olts/:oltId/speed-profiles/scan')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async scanOltRealSpeedProfiles(@Param('oltId') oltId: string) {
    return this.catalogsService.scanRealSpeedProfiles(oltId);
  }

  /** Descubrimiento brownfield: perfiles de tráfico de bajada que YA existen en la OLT real. Solo lectura. */
  @Get('olts/:oltId/traffic-profiles/scan')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async scanOltRealTrafficProfiles(@Param('oltId') oltId: string) {
    return this.catalogsService.scanRealTrafficProfiles(oltId);
  }

  /** Catálogo unificado de perfiles para una OLT (TCONT subida + Traffic bajada + Catálogo). */
  @Get('olts/:oltId/profiles-catalog')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  async getOltProfilesCatalog(@Param('oltId') oltId: string) {
    return this.catalogsService.getOltProfilesCatalog(oltId);
  }

  /** Da de alta en Sumtech un perfil TCONT descubierto por /speed-profiles/scan -- no escribe nada en la OLT, ya existía. */
  @Post('speed-profiles/import')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async importDiscoveredSpeedProfile(@Body() body: { name: string; speedKbps: number }) {
    return this.catalogsService.importDiscoveredSpeedProfile(body);
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
  async findAllOnuTypes(
    @Query('ponType') ponType?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.catalogsService.findAllOnuTypes(ponType, includeInactive === 'true');
  }

  @Post('onu-types')
  @Roles(Role.ADMIN, Role.GERENTE)
  async createOnuType(@Body() dto: CreateOnuTypeDto) {
    return this.catalogsService.createOnuType(dto);
  }

  @Patch('onu-types/:id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async updateOnuType(@Param('id') id: string, @Body() dto: UpdateOnuTypeDto) {
    return this.catalogsService.updateOnuType(id, dto);
  }

  @Delete('onu-types/:id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async deleteOnuType(@Param('id') id: string) {
    return this.catalogsService.deleteOnuType(id);
  }

  /**
   * Crea (o repara) este onu-type directamente en la OLT -- acción
   * deliberada, ya NO ocurre automáticamente al autorizar una ONU (ver
   * `verifyOnuTypeProfileWithSession` en zte-c320-profiles.ts). Mismo
   * patrón que `syncSpeedProfileToOlt`.
   */
  @Post('olts/:oltId/onu-types/:onuTypeId/sync')
  @Roles(Role.ADMIN, Role.GERENTE)
  async syncOnuTypeToOlt(@Param('oltId') oltId: string, @Param('onuTypeId') onuTypeId: string) {
    return this.catalogsService.syncOnuTypeToOlt(oltId, onuTypeId);
  }

  // ══════════════════════════════════════════════════
  // Redes TR-069 (RF-OLT-013)
  // ══════════════════════════════════════════════════
  @Get('tr069-networks')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  async findAllTr069Networks() {
    return this.catalogsService.findAllTr069Networks();
  }

  /**
   * Redes TR-069 REALES de una OLT puntual (ver `getTr069NetworksForOlt`) --
   * usar esta, NO `GET /olt/tr069-networks`, en OnuAuthorizeModal.
   */
  @Get('olts/:id/tr069-networks')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  async findTr069NetworksForOlt(@Param('id') id: string) {
    return this.catalogsService.getTr069NetworksForOlt(id);
  }

  @Post('tr069-networks')
  @Roles(Role.ADMIN, Role.GERENTE)
  async createTr069Network(@Body() dto: CreateTr069NetworkDto) {
    return this.catalogsService.createTr069Network(dto);
  }

  @Patch('tr069-networks/:id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async updateTr069Network(@Param('id') id: string, @Body() dto: UpdateTr069NetworkDto) {
    return this.catalogsService.updateTr069Network(id, dto);
  }

  @Delete('tr069-networks/:id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async deleteTr069Network(@Param('id') id: string) {
    return this.catalogsService.deleteTr069Network(id);
  }
}
