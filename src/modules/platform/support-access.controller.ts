import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SupportAccessService } from './support-access.service';
import { StartSupportSessionDto } from './dto/start-support-session.dto';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { PlatformRolesGuard } from './guards/platform-roles.guard';
import { PlatformRoles } from './decorators/platform-roles.decorator';
import { PlatformRole } from './enums/platform-role.enum';
import { CurrentPlatformUser } from './decorators/current-platform-user.decorator';
import { PlatformJwtPayload } from './interfaces/platform-jwt-payload.interface';

@Controller('platform/support/sessions')
export class SupportAccessController {
  constructor(private readonly supportService: SupportAccessService) {}

  @Post()
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN, PlatformRole.SUPPORT)
  @HttpCode(HttpStatus.CREATED)
  async startSession(
    @Body() dto: StartSupportSessionDto,
    @CurrentPlatformUser() admin: PlatformJwtPayload,
    @Req() req: any,
  ) {
    const ip = req.ip || req.connection?.remoteAddress;
    return this.supportService.startSession(dto, admin, ip);
  }

  @Post(':id/end')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN, PlatformRole.SUPPORT)
  @HttpCode(HttpStatus.OK)
  async endSession(
    @Param('id') id: string,
    @CurrentPlatformUser() admin: PlatformJwtPayload,
    @Req() req: any,
  ) {
    const ip = req.ip || req.connection?.remoteAddress;
    return this.supportService.endSession(id, admin.sub, ip);
  }

  @Get()
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN, PlatformRole.SUPPORT)
  async findAll(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('page') page?: string,
    @Query('tenantId') tenantId?: string,
    @Query('adminId') adminId?: string,
    @Query('onlyActive') onlyActive?: string,
  ) {
    return this.supportService.findAll({
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      tenantId,
      adminId,
      onlyActive: onlyActive === 'true',
    });
  }
}
