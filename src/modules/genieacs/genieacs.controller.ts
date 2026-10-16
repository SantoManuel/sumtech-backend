import { Body, Controller, Get, Patch, Post, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { GenieAcsMonitoringService } from './genieacs-monitoring.service';
import { GenieAcsWifiService } from './genieacs-wifi.service';
import { StaffChangeWifiCredentialsDto } from './dto/staff-change-wifi-credentials.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SaasFeatureGuard } from '../../common/guards/saas-feature.guard';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';

/**
 * Panel de soporte del ERP (Fase 03) — estado en vivo, reinicio remoto y
 * WiFi de la ONU de un contrato. Uso exclusivo de staff; la autogestión del
 * cliente vive en PortalController (/portal/wifi), no aquí — por eso el
 * cambio de WiFi de este controller no pide contraseña de cuenta: la propia
 * sesión de staff ya es la autorización (ver GenieAcsWifiService, que no
 * sabe ni le importa quién lo está llamando).
 * Protegido por SaasFeatureGuard: el tenant debe tener contratado el módulo GENIEACS.
 */
@Controller('genieacs/contracts')
@UseGuards(AuthGuard, RolesGuard, SaasFeatureGuard)
@RequireFeature('GENIEACS')
export class GenieAcsController {
  constructor(
    private readonly monitoringService: GenieAcsMonitoringService,
    private readonly wifiService: GenieAcsWifiService,
  ) {}

  @Get(':contractId/status')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getStatus(@Param('contractId', new ParseUUIDPipe()) contractId: string) {
    return this.monitoringService.getLiveStatus(contractId);
  }

  @Post(':contractId/reboot')
  @Roles(Role.ADMIN, Role.GERENTE)
  async reboot(@Param('contractId', new ParseUUIDPipe()) contractId: string, @CurrentUser('sub') userId: string) {
    await this.monitoringService.rebootDevice(contractId, userId);
    return {
      success: true,
      message: 'Se envió la orden de reinicio al equipo. Tardará aproximadamente 60 segundos en volver a estar disponible.',
    };
  }

  @Post(':contractId/factory-reset')
  @Roles(Role.ADMIN, Role.GERENTE)
  async factoryReset(@Param('contractId', new ParseUUIDPipe()) contractId: string, @CurrentUser('sub') userId: string) {
    await this.monitoringService.factoryResetDevice(contractId, userId);
    return {
      success: true,
      message: 'Se envió la orden de restauración de fábrica al equipo. Se restablecerán los parámetros predeterminados.',
    };
  }

  @Get(':contractId/wifi')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getWifi(@Param('contractId', new ParseUUIDPipe()) contractId: string) {
    return this.wifiService.getWifiStatus(contractId);
  }

  @Patch(':contractId/wifi')
  @Roles(Role.ADMIN, Role.GERENTE)
  async changeWifi(
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @Body() dto: StaffChangeWifiCredentialsDto,
  ) {
    const device = await this.wifiService.changeWifiCredentials(
      contractId,
      { ssid: dto.ssid, ssid5g: dto.ssid5g, password: dto.password },
      'STAFF',
    );
    return {
      success: true,
      ssid: device.ssid,
      ssid5g: device.ssid5g,
      message: 'El WiFi se está actualizando — el equipo del cliente se reiniciará y perderá la conexión unos segundos.',
    };
  }
}
