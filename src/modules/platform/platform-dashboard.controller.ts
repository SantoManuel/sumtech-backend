import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { PlatformRolesGuard } from './guards/platform-roles.guard';
import { PlatformRoles } from './decorators/platform-roles.decorator';
import { PlatformRole } from './enums/platform-role.enum';

@Controller('platform/dashboard')
export class PlatformDashboardController {
  constructor(private readonly dashboardService: PlatformDashboardService) {}

  @Get('metrics')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN, PlatformRole.SUPPORT)
  async getMetrics() {
    return this.dashboardService.getMetrics();
  }
}
