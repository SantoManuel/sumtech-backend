import { Controller, Get, UseGuards } from '@nestjs/common';
import { SaasSubscriptionsService } from './saas-subscriptions.service';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { PlatformRolesGuard } from './guards/platform-roles.guard';
import { PlatformRoles } from './decorators/platform-roles.decorator';
import { PlatformRole } from './enums/platform-role.enum';

@Controller('platform/subscriptions')
export class SaasSubscriptionsController {
  constructor(private readonly subscriptionsService: SaasSubscriptionsService) {}

  @Get()
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN, PlatformRole.SUPPORT)
  async findAll() {
    return this.subscriptionsService.findAll();
  }

  @Get('mrr')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN, PlatformRole.SUPPORT)
  async getMrr() {
    return this.subscriptionsService.getMrrReport();
  }
}
