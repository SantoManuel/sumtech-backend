import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { PppManagementService } from './services/ppp-management.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SaasFeatureGuard } from '../../common/guards/saas-feature.guard';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';

/**
 * Endpoints directos para gestión y monitoreo en tiempo real de accesos PPPoE (Nivel 2).
 */
@Controller('network/access')
@UseGuards(AuthGuard, RolesGuard, SaasFeatureGuard)
@RequireFeature('MIKROTIK')
export class NetworkAccessManagementController {
  constructor(private readonly pppManagementService: PppManagementService) {}

  @Get(':id/session')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async getSession(@Param('id') accessId: string) {
    return this.pppManagementService.getAccessSession(accessId);
  }

  @Post(':id/disconnect')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async disconnectSession(@Param('id') accessId: string, @CurrentUser('sub') userId?: string) {
    return this.pppManagementService.disconnectAccessSession(accessId, userId);
  }
}
