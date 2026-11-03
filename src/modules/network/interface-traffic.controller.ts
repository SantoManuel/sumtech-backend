import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { InterfaceTrafficService } from './services/interface-traffic.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@Controller('network/traffic')
@UseGuards(AuthGuard, RolesGuard)
export class InterfaceTrafficController {
  constructor(private readonly trafficService: InterfaceTrafficService) {}

  @Get('nodes/:nodeId/interfaces')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async getNodeInterfaces(@Param('nodeId') nodeId: string) {
    return this.trafficService.getNodeInterfaces(nodeId);
  }

  @Get('nodes/:nodeId/interfaces/:interfaceName')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async getInterfaceTraffic(
    @Param('nodeId') nodeId: string,
    @Param('interfaceName') interfaceName: string,
  ) {
    return this.trafficService.getInterfaceTraffic(nodeId, interfaceName);
  }
}
