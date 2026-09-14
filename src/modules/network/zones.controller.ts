import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ZonesService } from './zones.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { ListZonesDto } from './dto/list-zones.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('network/zones')
@UseGuards(AuthGuard, RolesGuard)
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE)
  async findAll(@Query() listZonesDto: ListZonesDto) {
    return this.zonesService.findAll(listZonesDto, !listZonesDto.includeInactive);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async findById(@Param('id') id: string) {
    return this.zonesService.findById(id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.GERENTE)
  async create(@Body() createZoneDto: CreateZoneDto) {
    return this.zonesService.create(createZoneDto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async update(@Param('id') id: string, @Body() updateZoneDto: UpdateZoneDto) {
    return this.zonesService.update(id, updateZoneDto);
  }

  @Patch(':id/deactivate')
  @Roles(Role.ADMIN, Role.GERENTE)
  async deactivate(@Param('id') id: string) {
    return this.zonesService.deactivate(id);
  }

  @Patch(':id/reactivate')
  @Roles(Role.ADMIN, Role.GERENTE)
  async reactivate(@Param('id') id: string) {
    return this.zonesService.reactivate(id);
  }
}
