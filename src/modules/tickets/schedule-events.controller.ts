import { 
  Controller, 
  Get, 
  Post, 
  Patch, 
  Delete, 
  Body, 
  Param, 
  Query, 
  UseGuards, 
  ParseUUIDPipe 
} from '@nestjs/common';
import { ScheduleEventsService } from './schedule-events.service';
import { 
  CreateScheduleEventDto, 
  UpdateScheduleEventDto, 
  FilterScheduleEventsDto 
} from './dto/schedule-event.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('schedule-events')
@UseGuards(AuthGuard, RolesGuard)
export class ScheduleEventsController {
  constructor(private readonly eventsService: ScheduleEventsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.CAJERO, Role.AGENTE_CRM)
  async findAll(@Query() filterDto: FilterScheduleEventsDto) {
    const data = await this.eventsService.findAll(filterDto);
    return { data, total: data.length };
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.CAJERO, Role.AGENTE_CRM)
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.eventsService.findById(id);
    return { data };
  }

  @Post()
  @Roles(Role.ADMIN, Role.GERENTE)
  async create(
    @CurrentUser() user: any,
    @Body() createDto: CreateScheduleEventDto,
  ) {
    const userId = user?.sub || user?.id;
    const data = await this.eventsService.create(userId, createDto);
    return { data, message: 'Actividad de oficina agendada exitosamente' };
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateScheduleEventDto,
  ) {
    const data = await this.eventsService.update(id, updateDto);
    return { data, message: 'Actividad actualizada exitosamente' };
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventsService.delete(id);
  }
}
