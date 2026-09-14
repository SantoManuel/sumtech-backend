import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PortalService } from './portal.service';
import {
  UploadDepositProofDto,
  CreatePlanChangeRequestDto,
  PortalChatMessageDto,
  ConvertChatToTicketDto,
  FilterPortalTicketDto
} from './dto/portal.dto';
import { RejectDepositProofDto } from './dto/reject-deposit-proof.dto';
import { ChangeWifiCredentialsDto } from '../genieacs/dto/change-wifi-credentials.dto';
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

  @Get('tickets')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async getTickets(
    @CurrentUser('sub') userId: string,
    @Query() filterDto: FilterPortalTicketDto,
  ) {
    return this.portalService.getTickets(userId, filterDto);
  }

  @Get('invoices')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async getInvoices(@CurrentUser('sub') userId: string) {
    return this.portalService.getInvoices(userId);
  }

  @Post('deposit-proofs')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  @UseInterceptors(FileInterceptor('receiptFile', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async submitDepositProof(
    @CurrentUser('sub') userId: string,
    @Body() dto: UploadDepositProofDto,
    @UploadedFile() receiptFile?: Express.Multer.File,
  ) {
    return this.portalService.submitDepositProof(userId, dto, receiptFile);
  }

  @Get('deposit-proofs')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async getDepositProofs(@CurrentUser('sub') userId: string) {
    return this.portalService.getDepositProofs(userId);
  }

  @Get('admin/deposit-proofs')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM)
  async getAllDepositProofs(@Query('status') status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED') {
    return this.portalService.getAllDepositProofs(status);
  }

  @Patch('deposit-proofs/:id/approve')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM)
  async approveDepositProof(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.portalService.approveDepositProof(id, userId);
  }

  @Patch('deposit-proofs/:id/reject')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM)
  async rejectDepositProof(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: RejectDepositProofDto,
  ) {
    return this.portalService.rejectDepositProof(id, userId, dto.reason);
  }

  @Post('deposit-proofs/:id/apply/:invoiceId')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM)
  async applyDepositProofToInvoice(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.portalService.applyDepositProofToInvoice(id, invoiceId, userId);
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

  @Patch('notifications/read-all')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async markAllNotificationsRead(@CurrentUser('sub') userId: string) {
    return this.portalService.markAllNotificationsRead(userId);
  }

  @Delete('notifications/:id')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async deleteNotification(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.portalService.deleteNotification(userId, id);
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

  @Get('wifi')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async getWifiStatus(@CurrentUser('sub') userId: string, @Query('contractId') contractId: string) {
    return this.portalService.getWifiStatus(userId, contractId);
  }

  @Patch('wifi')
  @Roles(Role.CLIENTE, Role.ADMIN, Role.GERENTE)
  async changeWifiCredentials(@CurrentUser('sub') userId: string, @Body() dto: ChangeWifiCredentialsDto) {
    return this.portalService.changeWifiCredentials(userId, dto);
  }
}
