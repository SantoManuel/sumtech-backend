import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { GisTopologyService } from './services/gis-topology.service';
import { UpdateGisCoordinatesDto } from './dto/update-gis-coordinates.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@Controller('network/gis')
@UseGuards(AuthGuard, RolesGuard)
export class GisController {
  constructor(private readonly gisService: GisTopologyService) {}

  @Get('topology')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async getTopology(@Query('zoneId') zoneId?: string, @Query('oltId') oltId?: string) {
    return this.gisService.getTopology({ zoneId, oltId });
  }

  @Patch('nap-boxes/:id/coordinates')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async updateNapCoordinates(
    @Param('id') id: string,
    @Body() dto: UpdateGisCoordinatesDto,
  ) {
    return this.gisService.updateNapCoordinates(id, dto);
  }

  @Patch('clients/:clientId/coordinates')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async updateClientCoordinates(
    @Param('clientId') clientId: string,
    @Body() dto: UpdateGisCoordinatesDto,
  ) {
    return this.gisService.updateClientCoordinates(clientId, dto);
  }
}
