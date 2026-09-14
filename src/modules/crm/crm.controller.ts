import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { CrmService } from './crm.service';
import { CreateLeadDto, CreateInteractionDto, FilterLeadDto } from './dto/crm.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { LeadStatus } from './enums/lead.enums';

@Controller('crm')
@UseGuards(AuthGuard, RolesGuard)
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Get('leads')
  @Roles(Role.ADMIN, Role.GERENTE, Role.AGENTE_CRM)
  async findAllLeads(@Query() filterDto: FilterLeadDto) {
    return this.crmService.findAllLeads(filterDto, filterDto.status);
  }

  @Post('leads')
  @Roles(Role.ADMIN, Role.GERENTE, Role.AGENTE_CRM)
  async createLead(@Body() createLeadDto: CreateLeadDto) {
    return this.crmService.createLead(createLeadDto);
  }

  @Patch('leads/:id/status')
  @Roles(Role.ADMIN, Role.GERENTE, Role.AGENTE_CRM)
  async updateLeadStatus(
    @Param('id') id: string,
    @Body('status') status: LeadStatus,
  ) {
    return this.crmService.updateLeadStatus(id, status);
  }

  @Get('interactions/client/:clientId')
  @Roles(Role.ADMIN, Role.GERENTE, Role.AGENTE_CRM, Role.CAJERO)
  async findInteractions(@Param('clientId') clientId: string) {
    return this.crmService.findInteractionsByClient(clientId);
  }

  @Post('interactions')
  @Roles(Role.ADMIN, Role.GERENTE, Role.AGENTE_CRM)
  async createInteraction(@CurrentUser('sub') userId: string, @Body() dto: CreateInteractionDto) {
    return this.crmService.createInteraction(userId, dto);
  }
}
