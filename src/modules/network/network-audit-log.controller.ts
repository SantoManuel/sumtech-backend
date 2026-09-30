import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { NetworkProvisioningService } from './network-provisioning.service';
import { FindAuditLogDto } from './dto/find-audit-log.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SaasFeatureGuard } from '../../common/guards/saas-feature.guard';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';

/**
 * Pantalla de auditoría de red (Fase 09): responde "¿por qué a este cliente
 * le cortaron el servicio?" con datos reales — ver ProvisioningAuditLogEntity.
 * Protegido por SaasFeatureGuard: el tenant debe tener contratado el módulo MIKROTIK.
 */
@Controller('network/audit-log')
@UseGuards(AuthGuard, RolesGuard, SaasFeatureGuard)
@RequireFeature('MIKROTIK')
export class NetworkAuditLogController {
  constructor(private readonly provisioningService: NetworkProvisioningService) {}

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE)
  async findAll(@Query() dto: FindAuditLogDto) {
    return this.provisioningService.findAuditLog(dto);
  }
}
