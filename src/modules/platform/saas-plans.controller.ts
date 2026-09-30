import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SaasPlansService } from './saas-plans.service';
import { CreateSaasPlanDto } from './dto/create-saas-plan.dto';
import { UpdateSaasPlanDto } from './dto/update-saas-plan.dto';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { PlatformRolesGuard } from './guards/platform-roles.guard';
import { PlatformRoles } from './decorators/platform-roles.decorator';
import { PlatformRole } from './enums/platform-role.enum';
import { CurrentPlatformUser } from './decorators/current-platform-user.decorator';
import { PlatformJwtPayload } from './interfaces/platform-jwt-payload.interface';

@Controller('platform/plans')
export class SaasPlansController {
  constructor(private readonly plansService: SaasPlansService) {}

  @Get()
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN, PlatformRole.SUPPORT)
  async findAll(@Query('onlyActive') onlyActive?: string) {
    return this.plansService.findAll(onlyActive === 'true');
  }

  @Get(':id')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN, PlatformRole.SUPPORT)
  async findOne(@Param('id') id: string) {
    return this.plansService.findOne(id);
  }

  @Post()
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateSaasPlanDto,
    @CurrentPlatformUser() admin: PlatformJwtPayload,
    @Req() req: any,
  ) {
    const ip = req.ip || req.connection?.remoteAddress;
    return this.plansService.create(dto, admin.sub, ip);
  }

  @Put(':id')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSaasPlanDto,
    @CurrentPlatformUser() admin: PlatformJwtPayload,
    @Req() req: any,
  ) {
    const ip = req.ip || req.connection?.remoteAddress;
    return this.plansService.update(id, dto, admin.sub, ip);
  }

  @Delete(':id')
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN)
  async remove(
    @Param('id') id: string,
    @CurrentPlatformUser() admin: PlatformJwtPayload,
    @Req() req: any,
  ) {
    const ip = req.ip || req.connection?.remoteAddress;
    return this.plansService.remove(id, admin.sub, ip);
  }
}
