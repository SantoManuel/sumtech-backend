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
  HttpCode,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SaasFeatureGuard } from '../../common/guards/saas-feature.guard';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { OnuManagementService } from './services/onu-management.service';
import { OnuTr069OperationsService } from './services/onu-tr069-operations.service';
import { Tr069OperationDto } from './dto/tr069-operation.dto';
import { OltPermissionGuard, RequireOltAction, OltIdFrom } from './guards/olt-permission.guard';
import { ListUnconfiguredOnusDto, ListOnusDto } from './dto/list-onus.dto';
import { MigrateOnuDto } from './dto/migrate-onu.dto';
import { ConfigureOnuWanDto } from './dto/configure-onu-wan.dto';
import { OnuOmciWanProfileDto } from './dto/onu-omci-wan-profile.dto';
import { RetryOnuWanDto } from './dto/retry-onu-wan.dto';
import { BatchTr069AcsDto } from './dto/batch-tr069-acs.dto';
import { UpdateOnuOltInfoDto } from './dto/update-onu-olt-info.dto';
import { StaffChangeWifiCredentialsDto } from '../genieacs/dto/staff-change-wifi-credentials.dto';

@Controller('olt/onus')
@UseGuards(AuthGuard, RolesGuard, SaasFeatureGuard, OltPermissionGuard)
@RequireFeature('OLT')
export class OnuController {
  constructor(private readonly onuService: OnuManagementService, private readonly tr069: OnuTr069OperationsService) { }

  /**
   * Bandeja de entrada de ONUs sin configurar descubiertas (RF-OLT-014).
   */
  @Get('unconfigured')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  @RequireOltAction('VIEW')
  async findUnconfigured(@Query() dto: ListUnconfiguredOnusDto) {
    return this.onuService.findUnconfigured(dto);
  }

  /**
   * Listado general de ONUs con filtros opcionales.
   */
  @Get()
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  @RequireOltAction('VIEW')
  async findAll(@Query() dto: ListOnusDto) {
    return this.onuService.findAll(dto);
  }

  /**
   * Dispara escaneo activo de ONUs no configuradas en una OLT (RF-OLT-014).
   */
  @Post('scan-unconfigured')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('OPERATE')
  async scanUnconfigured(@Body() body: { oltId: string }, @Req() req: any) {
    return this.onuService.scanUnconfiguredOnus(body.oltId, req.user?.id);
  }

  /**
   * Importación pasiva de ONUs ya autorizadas por la propia OLT (brownfield,
   * ej. otro sistema de gestión) en un puerto PON puntual. Permiso OPERATE
   * (no CONFIGURE): nunca escribe nada en el equipo, solo lee y refleja en BD.
   */
  @Post('scan-authorized')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('OPERATE')
  async scanAuthorized(@Body() body: { oltId: string; ponInterface: string }, @Req() req: any) {
    return this.onuService.scanAuthorizedOnus(body.oltId, body.ponInterface, req.user?.id);
  }

  /**
   * Actualización masiva (1 a N) del puntero ACS TR-069.
   * Ejecuta la reconfiguración agrupada por OLT optimizando las sesiones Telnet.
   */
  @Post('batch-tr069-acs')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('OPERATE')
  async batchUpdateTr069AcsUrl(
    @Body() dto: BatchTr069AcsDto,
    @Req() req: any,
  ) {
    return this.onuService.batchUpdateTr069AcsUrl(dto, req.user?.id);
  }

  /**
   * Vincula una ONU ya ACTIVE (típicamente importada sin contrato) a un
   * contrato real. Mismo nivel de permiso que authorize (CONFIGURE): es una
   * decisión de negocio (a qué cliente pertenece este equipo), aunque no
   * toque la OLT físicamente.
   */
  @Post(':id/link-contract')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async linkContract(@Param('id') id: string, @Body() body: { contractId: string }, @Req() req: any) {
    return this.onuService.linkOnuToContract(id, body.contractId, req.user?.id);
  }

  /**
   * Ficha 360 de la ONU con inventario, contrato, VLANs y estado.
   */
  @Get(':id/available-onu-id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('VIEW')
  @OltIdFrom('ONU_ID_PARAM')
  async getAvailableOnuId(@Param('id') id: string) {
    return this.onuService.getAvailableOnuId(id);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  @RequireOltAction('VIEW')
  @OltIdFrom('ONU_ID_PARAM')
  async findById(@Param('id') id: string) {
    return this.onuService.findById(id);
  }

  /**
   * Configuración activa ("show this" / running-config de la sub-interfaz gpon-onu)
   * consultada directamente en la OLT con name, description, zona, GPS, VLANs y perfiles.
   */
  @Get(':id/running-config')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  @RequireOltAction('VIEW')
  @OltIdFrom('ONU_ID_PARAM')
  async getOnuRunningConfig(@Param('id') id: string) {
    return this.onuService.getOnuRunningConfig(id);
  }

  /**
   * Actualiza los datos administrativos (name / description) de la ONU directamente
   * en la sub-interfaz de la OLT y sincroniza la base de datos.
   */
  @Patch(':id/olt-info')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async updateOnuOltInfo(
    @Param('id') id: string,
    @Body() dto: UpdateOnuOltInfoDto,
    @Req() req: any,
  ) {
    return this.onuService.updateOnuOltInfo(id, dto, req.user?.id);
  }

  /**
   * Telemetría óptica en vivo (dBm RX/TX y atenuación) (RF-OLT-015).
   */
  @Get(':id/optical-power')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  @RequireOltAction('OPERATE')
  @OltIdFrom('ONU_ID_PARAM')
  async getOpticalTelemetry(@Param('id') id: string) {
    return this.onuService.getOpticalTelemetry(id);
  }

  /**
   * Auditoría de aprovisionamiento: corre en vivo contra la OLT los `show`
   * de diagnóstico (detail-info, wan-ip, tr069-mgmt, tabla MAC) y resalta
   * discrepancias conocidas (Config state ≠ success, tipo de ONU distinto
   * al esperado, IP de gestión en 0.0.0.0, ACS desalineado, VLANs sin
   * tráfico). Ver Plan_Implementacion_Auditoria_Aprovisionamiento_ONU.md.
   */
  @Get(':id/provisioning-audit')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('OPERATE')
  @OltIdFrom('ONU_ID_PARAM')
  async getProvisioningAudit(@Param('id') id: string) {
    return this.onuService.getProvisioningAudit(id);
  }

  /**
   * Opción A de recuperación de IP ("Reaplicar wan-ip") desde la pestaña de
   * Auditoría -- CONFIRMADA EN VIVO (2026-10-30, OLT_Tabara_Abajo, ONU
   * ECOM0F91DF9B). No toca el resto del cableado OMCI.
   */
  @Post(':id/apply-wan-ip-fix')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('OPERATE')
  @OltIdFrom('ONU_ID_PARAM')
  async applyWanIpFix(@Param('id') id: string) {
    return this.onuService.applyWanIpFix(id);
  }

  /**
   * Opción B ("último recurso") de recuperación de IP desde la pestaña de
   * Auditoría -- DESTRUCTIVA: borra flow/switchport-bind/veip de ambos
   * canales y los reemplaza por "service <id> gemport <id> vlan <vlan>".
   * CONFIRMADA EN VIVO (2026-10-30, OLT_Tabara_Abajo, ONU ECOM0F91DF9B).
   */
  @Post(':id/apply-service-gemport-fix')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async applyServiceGemportFix(@Param('id') id: string) {
    return this.onuService.applyServiceGemportFix(id);
  }

  /**
   * Serie temporal histórica de potencia óptica (SmartOLT benchmark Sección 5.3).
   */
  @Get(':id/optical-history')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  @RequireOltAction('VIEW')
  @OltIdFrom('ONU_ID_PARAM')
  async getOpticalHistory(
    @Param('id') id: string,
    @Query('days') days?: string,
  ) {
    const numDays = days ? parseInt(days, 10) : 30;
    return this.onuService.getOpticalHistory(id, isNaN(numDays) ? 30 : numDays);
  }

  /**
   * Vista previa (dry-run) del script CLI generado antes de aprovisionar (RF-OLT-018).
   */
  @Post(':id/preview-script')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async previewScript(@Param('id') id: string, @Body() dto: any) {
    return this.onuService.previewAuthorizationScript(id, dto);
  }

  /**
   * Autorización y aprovisionamiento integral de la ONU (RF-OLT-016 / RF-ONU-001 a 007).
   */
  @Post(':id/authorize')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async authorizeOnu(
    @Param('id') id: string,
    @Body() dto: any,
    @Req() req: any,
  ) {
    return this.onuService.authorizeOnu(id, dto, req.user?.id);
  }

  /**
   * Vista previa (dry-run) del script CLI de "Aplicar Perfil TR-069" (Etapa
   * 2) antes de ejecutarlo -- mismo propósito que "preview-script" (Etapa 1,
   * RF-OLT-018).
   */
  @Post(':id/preview-tr069-script')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async previewTr069Script(@Param('id') id: string, @Body() dto: any) {
    return this.onuService.previewTr069ProfileScript(id, dto);
  }

  /**
   * Etapa 2 (flujo de 3 etapas): apunta una ONU ya autorizada ópticamente al
   * ACS (TR-069), sin tocar GenieACS/WAN todavía.
   */
  @Post(':id/tr069-profile')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async applyTr069Profile(
    @Param('id') id: string,
    @Body() dto: Tr069OperationDto,
    @Req() req: any,
  ) {
    return this.onuService.applyTr069Profile(id, dto, req.user?.id);
  }

  /**
   * Acción aislada de la Etapa 2: cambia SOLO el ACS al que apunta la ONU
   * (sin re-cablear tcont/gemport/service-port/flow/veip de la VLAN de
   * gestión) -- a diferencia de "tr069-profile", un rechazo de la OLT acá
   * SIEMPRE es un error duro (400), nunca un éxito silencioso con warning.
   */
  @Post(':id/tr069-acs')

  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async updateTr069AcsUrl(
    @Param('id') id: string,
    @Body() dto: Tr069OperationDto,
    @Req() req: any,
  ) {
    return this.onuService.updateTr069AcsUrl(id, dto, req.user?.id);
  }

  @Get(':id/tr069-operations/latest')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('VIEW')
  @OltIdFrom('ONU_ID_PARAM')
  async latestTr069Operation(@Param('id') id: string) { return this.tr069.latest(id); }

  @Get(':id/tr069-operations/:operationId')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('VIEW')
  @OltIdFrom('ONU_ID_PARAM')
  async getTr069Operation(@Param('id') id: string, @Param('operationId') operationId: string) { return this.tr069.get(id, operationId); }

  /**
   * Etapa 3 (flujo de 3 etapas): empuja WAN/PPPoE/WiFi al CPE vía GenieACS --
   * exige que la Etapa 2 (tr069-profile) ya se haya aplicado.
   */
  @Post(':id/wan-config')

  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async pushWanConfig(
    @Param('id') id: string,
    @Body() dto: ConfigureOnuWanDto,
    @Req() req: any,
  ) {
    return this.onuService.pushWanConfig(id, dto, req.user?.id);
  }

  @Get(':id/wan-operations/:operationId')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('VIEW')
  @OltIdFrom('ONU_ID_PARAM')
  getWanOperation(@Param('id') id: string, @Param('operationId') operationId: string) {
    return this.onuService.getWanOperation(id, operationId);
  }

  @Post(':id/wan-omci-profile')
  @Roles(Role.ADMIN, Role.GERENTE)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  saveOmciWanProfile(@Param('id') id: string, @Body() dto: OnuOmciWanProfileDto, @Req() req: any) {
    return this.onuService.saveOmciWanProfile(id, dto, req.user?.id);
  }

  @Post(':id/sync-cpe')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async syncCpe(@Param('id') id: string, @Req() req: any) {
    return this.onuService.syncCpe(id, req.user?.id);
  }

  @Patch(':id/wifi')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async changeWifi(
    @Param('id') id: string,
    @Body() dto: StaffChangeWifiCredentialsDto,
    @Req() req: any,
  ) {
    return this.onuService.changeWifi(id, dto, req.user?.id);
  }

  @Post(':id/wan-verify')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  verifyWan(@Param('id') id: string) { return this.onuService.verifyWan(id); }

  @Post(':id/wan-operations/:operationId/retry')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  retryWan(@Param('id') id: string, @Param('operationId') op: string, @Body() dto: RetryOnuWanDto, @Req() req: any) {
    return this.onuService.retryWan(id, op, dto.acknowledged, req.user?.id);
  }

  /**
   * Reconfigura método de gestión / VLANs de gestión / modo de operación de
   * una ONU ya autorizada y reintenta el push a GenieACS, sin volver a
   * disparar el CLI de autorización en la OLT.
   */
  @Post(':id/reprovision')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async reprovisionOnu(
    @Param('id') id: string,
    @Body() dto: any,
    @Req() req: any,
  ) {
    return this.onuService.reprovisionOnu(id, dto, req.user?.id);
  }

  /**
   * Bloqueo administrativo de tráfico óptico en la OLT (RF-OLT-017).
   */
  @Post(':id/block')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('OPERATE')
  @OltIdFrom('ONU_ID_PARAM')
  async blockOnu(@Param('id') id: string, @Req() req: any) {
    return this.onuService.blockOnu(id, req.user?.id);
  }

  /**
   * Desbloqueo y reactivación de tráfico óptico en la OLT (RF-OLT-017).
   */
  @Post(':id/unblock')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('OPERATE')
  @OltIdFrom('ONU_ID_PARAM')
  async unblockOnu(@Param('id') id: string, @Req() req: any) {
    return this.onuService.unblockOnu(id, req.user?.id);
  }

  /**
   * Elimina el registro de la ONU en la OLT y en la BD, liberando el onuId
   * para que vuelva a aparecer en "Bandeja Sin Configurar" (revertir una
   * autorización mal hecha). Mismo nivel de permiso que authorize/preview-script
   * (CONFIGURE), no OPERATE: borrar la config es tan sensible como crearla.
   */
  /**
     * Reinicia la ONU mediante comando OMCI en la OLT.
     */
  @Post(':id/reboot')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('OPERATE')
  @OltIdFrom('ONU_ID_PARAM')
  async rebootOnu(@Param('id') id: string, @Req() req: any) {
    return this.onuService.rebootOnu(id, req.user?.id);
  }

  /**
   * Restablece la configuración de fábrica de la ONU mediante comando OMCI en la OLT.
   */
  @Post(':id/factory-reset')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async factoryResetOnu(@Param('id') id: string, @Req() req: any) {
    return this.onuService.factoryResetOnu(id, req.user?.id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async deleteOnu(@Param('id') id: string, @Req() req: any) {
    return this.onuService.deleteOnu(id, req.user?.id);
  }

  /**
   * Migración y reemplazo de hardware de ONU (Benchmark SmartOLT Sección 2).
   * Reemplaza el equipo manteniendo la asignación de servicio y el contrato.
   */
  @Post(':id/migrate')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async migrateOnu(
    @Param('id') id: string,
    @Body() dto: MigrateOnuDto,
    @Req() req: any,
  ) {
    return this.onuService.migrateOnu(id, dto, req.user?.id);
  }
}
