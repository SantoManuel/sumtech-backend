import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('branches')
@UseGuards(AuthGuard, RolesGuard)
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  // Lectura abierta a todo el staff autenticado: la usan los selectores de
  // sucursal/caja en Empleados, apertura de turno POS y reportes.
  @Get()
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM)
  async findAll(@Query('activeOnly') activeOnly?: string) {
    return this.branchesService.findAll(activeOnly === 'true');
  }

  @Post()
  @Roles(Role.ADMIN, Role.GERENTE)
  async create(@Body() dto: CreateBranchDto) {
    return this.branchesService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.branchesService.update(id, dto);
  }
}
