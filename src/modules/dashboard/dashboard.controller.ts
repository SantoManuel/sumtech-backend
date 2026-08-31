import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('dashboard')
@UseGuards(AuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM)
  async getSummary() {
    return this.dashboardService.getSummary();
  }

  @Get('revenue-trend')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async getRevenueTrend(@Query('days') days?: number) {
    return this.dashboardService.getRevenueTrend(days ? Number(days) : 7);
  }
}
