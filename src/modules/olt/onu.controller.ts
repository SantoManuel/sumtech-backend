import {
  Controller,
  Get,
  Post,
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
  async findUnconfigured(@Query('oltId') oltId?: string) {
    return this.onuService.findUnconfigured(oltId);
  }

  /**
   * Listado general de ONUs con filtros opcionales.
   */
  @Get()
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  @RequireOltAction('VIEW')
  async findAll(
    @Query('oltId') oltId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.onuService.findAll({ oltId, status, search });
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
}
