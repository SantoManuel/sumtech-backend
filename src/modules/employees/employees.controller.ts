import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto, FilterEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('employees')
@UseGuards(AuthGuard, RolesGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE)
  async findAll(@Query() filterDto: FilterEmployeeDto) {
    return this.employeesService.findAll(filterDto, filterDto.role);
  }

  /**
   * Directorio liviano (id, cargo, usuario) sin datos sensibles como salario —
   * lo consume el tablero de tickets/Gantt para mostrar nombre/cuadrilla de
   * cualquier empleado, incluyendo técnicos que no pueden ver /employees.
   * Debe declararse antes de ':id' para no ser interceptada por esa ruta.
   */
  @Get('directory')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM, Role.CAJERO)
  async findDirectory() {
    return this.employeesService.findDirectory();
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async findById(@Param('id') id: string) {
    return this.employeesService.findById(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(@Body() createEmployeeDto: CreateEmployeeDto) {
    return this.employeesService.create(createEmployeeDto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(@Param('id') id: string, @Body() updateEmployeeDto: UpdateEmployeeDto) {
    return this.employeesService.update(id, updateEmployeeDto);
  }
}
