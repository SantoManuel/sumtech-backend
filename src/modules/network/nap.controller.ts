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
  ParseIntPipe,
} from '@nestjs/common';
import { NapManagementService } from './services/nap-management.service';
import {
  CreateNapBoxDto,
  UpdateNapBoxDto,
  ListNapBoxesDto,
  UpdateNapPortDto,
} from './dto/nap.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('network/naps')
@UseGuards(AuthGuard, RolesGuard)
export class NapController {
  constructor(private readonly napService: NapManagementService) {}

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  async findAll(@Query() dto: ListNapBoxesDto) {
    return this.napService.findAll(dto);
  }

  @Get('gis')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  async getGisPoints() {
    return this.napService.getGisPoints();
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO, Role.AGENTE_CRM)
  async findById(@Param('id') id: string) {
    return this.napService.findById(id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.GERENTE)
  async create(
    @Body() dto: CreateNapBoxDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.napService.create(dto, userId);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateNapBoxDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.napService.update(id, dto, userId);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async delete(
    @Param('id') id: string,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.napService.delete(id, userId);
  }

  @Patch(':id/ports/:portNumber')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async updatePort(
    @Param('id') id: string,
    @Param('portNumber', ParseIntPipe) portNumber: number,
    @Body() dto: UpdateNapPortDto,
    @CurrentUser('sub') userId?: string,
  ) {
    return this.napService.updatePort(id, portNumber, dto, userId);
  }
}
