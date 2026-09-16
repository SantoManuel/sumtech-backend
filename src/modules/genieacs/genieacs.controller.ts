import { Controller, Get, Post, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { GenieAcsMonitoringService } from './genieacs-monitoring.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * Panel de soporte del ERP (Fase 03) — estado en vivo y reinicio remoto de
 * la ONU de un contrato. Uso exclusivo de staff; la autogestión del cliente
 * vive en PortalController (/portal/wifi), no aquí.
 */
@Controller('genieacs/contracts')
@UseGuards(AuthGuard, RolesGuard)
export class GenieAcsController {
  constructor(private readonly monitoringService: GenieAcsMonitoringService) {}

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
}
