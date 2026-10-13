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
    const access = userId !== undefined
      ? await this.provisioningService.upsertConfiguration(clientId, contractId, dto, userId)
      : await this.provisioningService.upsertConfiguration(clientId, contractId, dto);

    // Nunca se devuelve el cifrado al cliente — solo si hay una contraseña
    // configurada, para que la UI pueda mostrar "configurada" sin exponer ni
    // el texto plano ni el propio blob cifrado.
    const { pppoePasswordEnc, ...rest } = access;
    return { ...rest, hasPppoePassword: Boolean(pppoePasswordEnc) };
  }
}
