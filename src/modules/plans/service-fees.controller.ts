import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ServiceFeesService } from './service-fees.service';
import { CreateServiceFeeDto } from './dto/create-service-fee.dto';
import { UpdateServiceFeeDto } from './dto/update-service-fee.dto';
import { ListServiceFeesDto } from './dto/list-service-fees.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

const READ_ROLES = [Role.ADMIN, Role.GERENTE, Role.CAJERO];
const MANAGE_ROLES = [Role.ADMIN, Role.GERENTE];

/**
 * Catálogo de cargos de servicio puntuales (instalación, reparación) que
 * cobra el POS — a diferencia de PlansController, ningún endpoint es
 * @Public(): este catálogo es interno, nunca se expone al portal de
 * autoservicio ni a prospectos.
 */
@Controller('service-fees')
@UseGuards(AuthGuard, RolesGuard)
export class ServiceFeesController {
  constructor(private readonly serviceFeesService: ServiceFeesService) {}

  @Get()
  @Roles(...READ_ROLES)
  async findAll(@Query() listServiceFeesDto: ListServiceFeesDto) {
    return this.serviceFeesService.findAll(listServiceFeesDto, !listServiceFeesDto.includeInactive);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  async findById(@Param('id') id: string) {
    return this.serviceFeesService.findById(id);
  }

  @Post()
  @Roles(...MANAGE_ROLES)
  async create(@Body() createServiceFeeDto: CreateServiceFeeDto) {
    return this.serviceFeesService.create(createServiceFeeDto);
  }

  @Patch(':id')
  @Roles(...MANAGE_ROLES)
  async update(@Param('id') id: string, @Body() updateServiceFeeDto: UpdateServiceFeeDto) {
    return this.serviceFeesService.update(id, updateServiceFeeDto);
  }

  @Patch(':id/deactivate')
  @Roles(...MANAGE_ROLES)
  async deactivate(@Param('id') id: string) {
    return this.serviceFeesService.deactivate(id);
  }

  @Patch(':id/reactivate')
  @Roles(...MANAGE_ROLES)
  async reactivate(@Param('id') id: string) {
    return this.serviceFeesService.reactivate(id);
  }
}
