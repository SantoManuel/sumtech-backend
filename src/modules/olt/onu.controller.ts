import {
  Controller,
  Get,
  Post,
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
import { OnuManagementService } from './services/onu-management.service';
import { OltPermissionGuard, RequireOltAction, OltIdFrom } from './guards/olt-permission.guard';
import { ListUnconfiguredOnusDto, ListOnusDto } from './dto/list-onus.dto';
import { MigrateOnuDto } from './dto/migrate-onu.dto';

@Controller('olt/onus')
@UseGuards(AuthGuard, RolesGuard, SaasFeatureGuard, OltPermissionGuard)
@RequireFeature('OLT')
export class OnuController {
  constructor(private readonly onuService: OnuManagementService) {}

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
  @Get(':id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  @RequireOltAction('VIEW')
  @OltIdFrom('ONU_ID_PARAM')
  async findById(@Param('id') id: string) {
    return this.onuService.findById(id);
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
   * Etapa 2 (flujo de 3 etapas): apunta una ONU ya autorizada ópticamente al
   * ACS (TR-069), sin tocar GenieACS/WAN todavía.
   */
  @Post(':id/tr069-profile')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  @RequireOltAction('CONFIGURE')
  @OltIdFrom('ONU_ID_PARAM')
  async applyTr069Profile(
    @Param('id') id: string,
    @Body() dto: any,
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
    @Body() dto: any,
    @Req() req: any,
  ) {
    return this.onuService.updateTr069AcsUrl(id, dto, req.user?.id);
  }

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
    @Body() dto: any,
    @Req() req: any,
  ) {
    return this.onuService.pushWanConfig(id, dto, req.user?.id);
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
