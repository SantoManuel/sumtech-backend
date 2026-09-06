import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { FilterClientDto } from './dto/filter-client.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('clients')
@UseGuards(AuthGuard, RolesGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM)
  async findAll(@Query() filterDto: FilterClientDto) {
    return this.clientsService.findAll(filterDto, filterDto.search);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM)
  async findById(@Param('id') id: string) {
    return this.clientsService.findById(id);
  }

  @Get('doc/:docNumber')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM)
  async findByDoc(@Param('docNumber') docNumber: string) {
    return this.clientsService.findByDocNumber(docNumber);
  }

  @Post()
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM)
  async create(@Body() createClientDto: CreateClientDto) {
    return this.clientsService.create(createClientDto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM)
  async update(@Param('id') id: string, @Body() updateClientDto: UpdateClientDto) {
    return this.clientsService.update(id, updateClientDto);
  }

  @Get(':id/contracts')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM)
  async getContracts(@Param('id') id: string) {
    return this.clientsService.findContractsByClientId(id);
  }

  @Post(':id/contracts')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async addContract(
    @Param('id') id: string,
    @Body('planId') planId: string,
    @Body('addressId') addressId: string,
  ) {
    return this.clientsService.addContract(id, planId, addressId);
  }
}
