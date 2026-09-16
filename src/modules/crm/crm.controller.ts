import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { CrmService } from './crm.service';
import { CrmCatalogsService } from './crm-catalogs.service';
import { CreateOpportunityDto, UpdateOpportunityDto, UpdateOpportunityStatusDto, CreateInteractionDto, FilterOpportunityDto } from './dto/crm.dto';
import { CloseOpportunityDto } from './dto/close-opportunity.dto';
import {
  CreateSubscriptionStatusDto,
  UpdateSubscriptionStatusDto,
  CreateNextActionDto,
  UpdateNextActionDto,
  CreateLossReasonDto,
  UpdateLossReasonDto,
  UpsertSlaPolicyDto,
} from './dto/catalog.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

const CRM_EDIT_ROLES = [Role.ADMIN, Role.GERENTE, Role.AGENTE_CRM];
const CATALOG_ADMIN_ROLES = [Role.ADMIN, Role.GERENTE];

@Controller('crm')
@UseGuards(AuthGuard, RolesGuard)
export class CrmController {
  constructor(
    private readonly crmService: CrmService,
    private readonly crmCatalogsService: CrmCatalogsService,
  ) {}

  // --- Dashboard ---

  @Get('dashboard')
  @Roles(...CRM_EDIT_ROLES)
  async getDashboardMetrics() {
    return this.crmService.getDashboardMetrics();
  }

  // --- SLA comercial ---

  @Get('sla/breaches')
  @Roles(...CRM_EDIT_ROLES)
  async getSlaBreaches() {
    return this.crmService.findSlaBreaches();
  }

  // --- Encuestas de satisfacción ---

  @Get('satisfaction-surveys')
  @Roles(...CRM_EDIT_ROLES)
  async getSatisfactionSurveys() {
    return this.crmService.getSatisfactionSurveys();
  }

  // --- Opportunities ---

  @Get('opportunities')
  @Roles(...CRM_EDIT_ROLES)
  async findAllOpportunities(@Query() filterDto: FilterOpportunityDto) {
    return this.crmService.findAll(filterDto);
  }

  @Get('opportunities/:id')
  @Roles(...CRM_EDIT_ROLES)
  async findOpportunityById(@Param('id') id: string) {
    return this.crmService.findById(id);
  }

  @Post('opportunities')
  @Roles(...CRM_EDIT_ROLES)
  async createOpportunity(@CurrentUser('sub') userId: string, @Body() dto: CreateOpportunityDto) {
    return this.crmService.create(dto, userId);
  }

  @Patch('opportunities/:id')
  @Roles(...CRM_EDIT_ROLES)
  async updateOpportunity(@Param('id') id: string, @Body() dto: UpdateOpportunityDto) {
    return this.crmService.update(id, dto);
  }

  @Patch('opportunities/:id/status')
  @Roles(...CRM_EDIT_ROLES)
  async updateOpportunityStatus(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateOpportunityStatusDto,
  ) {
    return this.crmService.updateStatus(id, dto, userId);
  }

  @Post('opportunities/:id/close')
  @Roles(...CRM_EDIT_ROLES)
  async closeOpportunity(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() dto: CloseOpportunityDto) {
    return this.crmService.closeOpportunity(id, dto, userId);
  }

  @Get('opportunities/:id/conversation')
  @Roles(...CRM_EDIT_ROLES)
  async getOpportunityConversation(@Param('id') id: string) {
    return this.crmService.getOpportunityConversation(id);
  }

  @Get('opportunities/:id/history')
  @Roles(...CRM_EDIT_ROLES)
  async getOpportunityStateHistory(@Param('id') id: string) {
    return this.crmService.getStateHistory(id);
  }

  @Get('opportunities/:id/interactions')
  @Roles(...CRM_EDIT_ROLES)
  async getOpportunityInteractions(@Param('id') id: string) {
    return this.crmService.findInteractionsByOpportunity(id);
  }

  // --- Catálogos ---

  @Get('catalogs/subscription-statuses')
  @Roles(...CRM_EDIT_ROLES)
  async findSubscriptionStatuses(@Query('includeInactive') includeInactive?: string) {
    return this.crmCatalogsService.findAllSubscriptionStatuses(includeInactive === 'true');
  }

  @Post('catalogs/subscription-statuses')
  @Roles(...CATALOG_ADMIN_ROLES)
  async createSubscriptionStatus(@Body() dto: CreateSubscriptionStatusDto) {
    return this.crmCatalogsService.createSubscriptionStatus(dto);
  }

  @Patch('catalogs/subscription-statuses/:id')
  @Roles(...CATALOG_ADMIN_ROLES)
  async updateSubscriptionStatus(@Param('id') id: string, @Body() dto: UpdateSubscriptionStatusDto) {
    return this.crmCatalogsService.updateSubscriptionStatus(id, dto);
  }

  @Get('catalogs/next-actions')
  @Roles(...CRM_EDIT_ROLES)
  async findNextActions(@Query('includeInactive') includeInactive?: string) {
    return this.crmCatalogsService.findAllNextActions(includeInactive === 'true');
  }

  @Post('catalogs/next-actions')
  @Roles(...CATALOG_ADMIN_ROLES)
  async createNextAction(@Body() dto: CreateNextActionDto) {
    return this.crmCatalogsService.createNextAction(dto);
  }

  @Patch('catalogs/next-actions/:id')
  @Roles(...CATALOG_ADMIN_ROLES)
  async updateNextAction(@Param('id') id: string, @Body() dto: UpdateNextActionDto) {
    return this.crmCatalogsService.updateNextAction(id, dto);
  }

  @Get('catalogs/loss-reasons')
  @Roles(...CRM_EDIT_ROLES)
  async findLossReasons(@Query('includeInactive') includeInactive?: string) {
    return this.crmCatalogsService.findAllLossReasons(includeInactive === 'true');
  }

  @Post('catalogs/loss-reasons')
  @Roles(...CATALOG_ADMIN_ROLES)
  async createLossReason(@Body() dto: CreateLossReasonDto) {
    return this.crmCatalogsService.createLossReason(dto);
  }

  @Patch('catalogs/loss-reasons/:id')
  @Roles(...CATALOG_ADMIN_ROLES)
  async updateLossReason(@Param('id') id: string, @Body() dto: UpdateLossReasonDto) {
    return this.crmCatalogsService.updateLossReason(id, dto);
  }

  @Get('catalogs/sla-policies')
  @Roles(...CRM_EDIT_ROLES)
  async findSlaPolicies() {
    return this.crmCatalogsService.findAllSlaPolicies();
  }

  @Post('catalogs/sla-policies')
  @Roles(...CATALOG_ADMIN_ROLES)
  async upsertSlaPolicy(@Body() dto: UpsertSlaPolicyDto) {
    return this.crmCatalogsService.upsertSlaPolicy(dto);
  }

  // --- Interacciones / actividades ---

  @Get('interactions/client/:clientId')
  @Roles(Role.ADMIN, Role.GERENTE, Role.AGENTE_CRM, Role.CAJERO)
  async findInteractions(@Param('clientId') clientId: string) {
    return this.crmService.findInteractionsByClient(clientId);
  }

  @Post('interactions')
  @Roles(...CRM_EDIT_ROLES)
  async createInteraction(@CurrentUser('sub') userId: string, @Body() dto: CreateInteractionDto) {
    return this.crmService.createInteraction(userId, dto);
  }
}
