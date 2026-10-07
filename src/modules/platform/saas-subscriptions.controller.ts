import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SaasSubscriptionsService } from './saas-subscriptions.service';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { PlatformRolesGuard } from './guards/platform-roles.guard';
import { PlatformRoles } from './decorators/platform-roles.decorator';
import { PlatformRole } from './enums/platform-role.enum';
import { CurrentPlatformUser } from './decorators/current-platform-user.decorator';
import { PlatformJwtPayload } from './interfaces/platform-jwt-payload.interface';
import { ChangeSaasSubscriptionPlanDto } from './dto/change-saas-subscription-plan.dto';
import { UpdateSaasSubscriptionStatusDto } from './dto/update-saas-subscription-status.dto';
import { RecordManualPaymentDto } from './dto/record-manual-payment.dto';
import { ExtendSaasTrialDto } from './dto/extend-saas-trial.dto';

@Controller('platform/subscriptions')
export class SaasSubscriptionsController {
  constructor(private readonly subscriptionsService: SaasSubscriptionsService) {}

  @Get()
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN, PlatformRole.SUPPORT)
  async findAll(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('page') page?: string,
  ) {
    return this.subscriptionsService.findAll({
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      page: page ? parseInt(page, 10) : undefined,
    });
  }

  @Get('mrr')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN, PlatformRole.SUPPORT)
  async getMrr() {
    return this.subscriptionsService.getMrrReport();
  }

  @Get(':id')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN, PlatformRole.SUPPORT)
  async findOne(@Param('id') id: string) {
    return this.subscriptionsService.findOne(id);
  }

  @Patch(':id/plan')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN)
  async changePlan(
    @Param('id') id: string,
    @Body() dto: ChangeSaasSubscriptionPlanDto,
    @CurrentPlatformUser() admin: PlatformJwtPayload,
    @Req() req: any,
  ) {
    const ip = req.ip || req.connection?.remoteAddress;
    return this.subscriptionsService.changePlan(id, dto, admin.sub, ip);
  }

  @Patch(':id/status')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN)
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSaasSubscriptionStatusDto,
    @CurrentPlatformUser() admin: PlatformJwtPayload,
    @Req() req: any,
  ) {
    const ip = req.ip || req.connection?.remoteAddress;
    return this.subscriptionsService.updateStatus(id, dto, admin.sub, ip);
  }

  @Post(':id/manual-payment')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  async recordManualPayment(
    @Param('id') id: string,
    @Body() dto: RecordManualPaymentDto,
    @CurrentPlatformUser() admin: PlatformJwtPayload,
    @Req() req: any,
  ) {
    const ip = req.ip || req.connection?.remoteAddress;
    return this.subscriptionsService.recordManualPayment(id, dto, admin.sub, ip);
  }

  @Post(':id/extend-trial')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  async extendTrial(
    @Param('id') id: string,
    @Body() dto: ExtendSaasTrialDto,
    @CurrentPlatformUser() admin: PlatformJwtPayload,
    @Req() req: any,
  ) {
    const ip = req.ip || req.connection?.remoteAddress;
    return this.subscriptionsService.extendTrial(id, dto, admin.sub, ip);
  }

  @Post('sync')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  async syncMissing() {
    return this.subscriptionsService.syncMissingSubscriptions();
  }
}
