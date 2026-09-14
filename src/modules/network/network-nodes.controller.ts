import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { NetworkNodesService } from './network-nodes.service';
import { CreateNetworkNodeDto } from './dto/create-network-node.dto';
import { UpdateNetworkNodeDto } from './dto/update-network-node.dto';
import { ListNetworkNodesDto } from './dto/list-network-nodes.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('network/nodes')
@UseGuards(AuthGuard, RolesGuard)
export class NetworkNodesController {
  constructor(private readonly networkNodesService: NetworkNodesService) {}

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE)
  async findAll(@Query() listNetworkNodesDto: ListNetworkNodesDto) {
    return this.networkNodesService.findAll(listNetworkNodesDto, !listNetworkNodesDto.includeInactive);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async findById(@Param('id') id: string) {
    return this.networkNodesService.findById(id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.GERENTE)
  async create(@Body() createNetworkNodeDto: CreateNetworkNodeDto) {
    return this.networkNodesService.create(createNetworkNodeDto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async update(@Param('id') id: string, @Body() updateNetworkNodeDto: UpdateNetworkNodeDto) {
    return this.networkNodesService.update(id, updateNetworkNodeDto);
  }

  @Patch(':id/deactivate')
  @Roles(Role.ADMIN, Role.GERENTE)
  async deactivate(@Param('id') id: string) {
    return this.networkNodesService.deactivate(id);
  }

  @Patch(':id/reactivate')
  @Roles(Role.ADMIN, Role.GERENTE)
  async reactivate(@Param('id') id: string) {
    return this.networkNodesService.reactivate(id);
  }
}
