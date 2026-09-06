import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { CreateTicketDto, UpdateTicketStatusDto, SwapHardwareDto, FilterTicketDto, ScheduleTicketDto } from './dto/ticket.dto';
import { PivotScheduleDto } from './dto/pivot-schedule.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('tickets')
@UseGuards(AuthGuard, RolesGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.CAJERO, Role.AGENTE_CRM)
  async findAll(@Query() filterDto: FilterTicketDto) {
    return this.ticketsService.findAll(filterDto);
  }

  @Post('schedule/pivot')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async pivotSchedule(
    @CurrentUser('sub') userId: string,
    @Body() pivotDto: PivotScheduleDto,
  ) {
    return this.ticketsService.pivotSchedule(pivotDto, userId);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.CAJERO, Role.AGENTE_CRM)
  async findById(@Param('id') id: string) {
    return this.ticketsService.findById(id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM)
  async create(@Body() createTicketDto: CreateTicketDto) {
    return this.ticketsService.create(createTicketDto);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() updateStatusDto: UpdateTicketStatusDto,
  ) {
    return this.ticketsService.updateStatus(id, userId, updateStatusDto);
  }

  @Patch(':id/schedule')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async schedule(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() scheduleDto: ScheduleTicketDto,
  ) {
    return this.ticketsService.scheduleTicket(id, scheduleDto, userId);
  }

  @Post('swap-hardware')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async swapHardware(@CurrentUser('sub') userId: string, @Body() swapDto: SwapHardwareDto) {
    return this.ticketsService.swapHardware(swapDto, userId);
  }

  @Patch(':id/assign')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async reassign(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body('assignedEmployeeId') assignedEmployeeId: string,
  ) {
    return this.ticketsService.reassignTicket(id, assignedEmployeeId, userId);
  }
}
