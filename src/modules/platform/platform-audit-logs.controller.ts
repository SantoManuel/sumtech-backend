import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { PlatformRolesGuard } from './guards/platform-roles.guard';
import { PlatformRoles } from './decorators/platform-roles.decorator';
import { PlatformRole } from './enums/platform-role.enum';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

@Controller('platform/audit-logs')
export class PlatformAuditLogsController {
  constructor(private readonly auditService: PlatformAuditService) {}

  @Get()
  @UseGuards(PlatformAuthGuard, PlatformRolesGuard)
  @PlatformRoles(PlatformRole.SUPERADMIN)
  async findAll(@Query() query: QueryAuditLogsDto) {
    return this.auditService.findAll(query);
  }
}
