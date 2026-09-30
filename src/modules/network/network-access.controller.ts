import { Controller, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { NetworkProvisioningService } from './network-provisioning.service';
import { UpsertNetworkAccessDto } from './dto/upsert-network-access.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SaasFeatureGuard } from '../../common/guards/saas-feature.guard';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';

/**
 * Ruta anidada bajo /clients por legibilidad REST, pero es un controlador
 * propio del módulo network: no vive en ClientsController ni depende de
 * ClientsService. La validación de que el contrato pertenece al cliente pasa
 * por NetworkProvisioningService, contra el repositorio de ContractEntity.
 * Protegido por SaasFeatureGuard: el tenant debe tener contratado el módulo MIKROTIK.
 */
@Controller('clients/:clientId/contracts/:contractId/network-access')
@UseGuards(AuthGuard, RolesGuard, SaasFeatureGuard)
@RequireFeature('MIKROTIK')
export class NetworkAccessController {
  constructor(private readonly provisioningService: NetworkProvisioningService) {}

  @Patch()
  @Roles(Role.ADMIN, Role.GERENTE)
  async upsert(
    @Param('clientId') clientId: string,
    @Param('contractId') contractId: string,
    @Body() dto: UpsertNetworkAccessDto,
    @CurrentUser('sub') userId?: string,
  ) {
    if (userId !== undefined) {
      return this.provisioningService.upsertConfiguration(clientId, contractId, dto, userId);
    }
    return this.provisioningService.upsertConfiguration(clientId, contractId, dto);
  }
}
