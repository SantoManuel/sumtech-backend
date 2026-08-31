import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PortalService } from './portal.service';
import { 
  UploadDepositProofDto, 
  CreatePlanChangeRequestDto, 
  PortalChatMessageDto, 
  ConvertChatToTicketDto 
} from './dto/portal.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('portal')
@UseGuards(AuthGuard, RolesGuard)
export class PortalController {
  constructor(private readonly portalService: PortalService) {}

  @Get('dashboard')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async getDashboardSummary(
    @CurrentUser('sub') userId: string,
    @Query('contractId') contractId?: string,
  ) {
    return this.portalService.getDashboardSummary(userId, contractId);
  }

  @Get('invoices')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async getInvoices(@CurrentUser('sub') userId: string) {
    return this.portalService.getInvoices(userId);
  }

  @Post('deposit-proofs')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async submitDepositProof(
    @CurrentUser('sub') userId: string,
    @Body() dto: UploadDepositProofDto,
  ) {
    return this.portalService.submitDepositProof(userId, dto);
  }

  @Get('deposit-proofs')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async getDepositProofs(@CurrentUser('sub') userId: string) {
    return this.portalService.getDepositProofs(userId);
  }

  @Get('plans/available')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async getAvailablePlans(
    @CurrentUser('sub') userId: string,
    @Query('contractId') contractId: string,
  ) {
    return this.portalService.getAvailablePlansForUpgrade(userId, contractId);
  }

  @Post('plan-change-requests')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async submitPlanChangeRequest(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePlanChangeRequestDto,
  ) {
    return this.portalService.submitPlanChangeRequest(userId, dto);
  }

  @Get('notifications')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async getNotifications(@CurrentUser('sub') userId: string) {
    return this.portalService.getNotifications(userId);
  }

  @Patch('notifications/:id/read')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async markNotificationRead(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.portalService.markNotificationRead(userId, id);
  }

  @Post('chat/message')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async processChatMessage(
    @CurrentUser('sub') userId: string,
    @Body() dto: PortalChatMessageDto,
  ) {
    return this.portalService.processChatMessage(userId, dto);
  }

  @Post('chat/convert-ticket')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async convertChatToTicket(
    @CurrentUser('sub') userId: string,
    @Body() dto: ConvertChatToTicketDto,
  ) {
    return this.portalService.convertChatToTicket(userId, dto);
  }
}
