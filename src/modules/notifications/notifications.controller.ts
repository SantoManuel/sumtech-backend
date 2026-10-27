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
} from '@nestjs/common';
import { StaffNotificationService } from './notifications.service';
import { CreateStaffNotificationDto } from './dto/create-staff-notification.dto';
import { QueryStaffNotificationDto } from './dto/query-staff-notification.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('notifications')
@UseGuards(AuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: StaffNotificationService) {}

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM)
  async getNotifications(
    @CurrentUser('sub') userId: string,
    @CurrentUser('roles') roles: string[],
    @Query() query: QueryStaffNotificationDto,
  ) {
    return this.notificationsService.findAll(userId, roles, query);
  }

  @Get('unread-count')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM)
  async getUnreadCount(
    @CurrentUser('sub') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    const unreadCount = await this.notificationsService.getUnreadCount(userId, roles);
    return { unreadCount };
  }

  @Post('manual')
  @Roles(Role.ADMIN, Role.GERENTE)
  async createManualNotification(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateStaffNotificationDto,
  ) {
    return this.notificationsService.createAndEmit(dto, tenantId || 'default');
  }

  @Patch(':id/read')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM)
  async markAsRead(
    @CurrentUser('sub') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id') id: string,
  ) {
    return this.notificationsService.markAsRead(userId, roles, id);
  }

  @Patch('read-all')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM)
  async markAllAsRead(
    @CurrentUser('sub') userId: string,
    @CurrentUser('roles') roles: string[],
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.notificationsService.markAllAsRead(userId, roles, tenantId || 'default');
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM)
  async deleteNotification(
    @CurrentUser('sub') userId: string,
    @CurrentUser('roles') roles: string[],
    @Param('id') id: string,
  ) {
    return this.notificationsService.delete(userId, roles, id);
  }
}
