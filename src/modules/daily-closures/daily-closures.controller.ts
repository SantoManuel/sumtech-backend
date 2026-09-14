import { Controller, Get, Post, Body, Param, Query, UseGuards, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { DailyClosuresService } from './daily-closures.service';
import { CreateDailyClosureDto } from './dto/create-daily-closure.dto';
import { StartJornadaDto } from './dto/start-jornada.dto';
import { FindDailyClosuresDto } from './dto/find-daily-closures.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('daily-closures')
@UseGuards(AuthGuard, RolesGuard)
export class DailyClosuresController {
  constructor(private readonly dailyClosuresService: DailyClosuresService) {}

  @Post('start')
  @Roles(Role.TECNICO)
  async start(@CurrentUser('employeeId') employeeId: string, @Body() dto: StartJornadaDto) {
    return this.dailyClosuresService.startJornada(employeeId, dto);
  }

  @Get('today/status')
  @Roles(Role.TECNICO)
  async todayStatus(@CurrentUser('employeeId') employeeId: string) {
    return this.dailyClosuresService.getTodayStatus(employeeId);
  }

  @Post('close')
  @Roles(Role.TECNICO)
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'receipts', maxCount: 20 },
    { name: 'fuelReceipt', maxCount: 1 },
  ]))
  async close(
    @CurrentUser('employeeId') employeeId: string,
    @Body() dto: CreateDailyClosureDto,
    @UploadedFiles() files: { receipts?: Express.Multer.File[]; fuelReceipt?: Express.Multer.File[] },
  ) {
    return this.dailyClosuresService.close(employeeId, dto, dto.expenses, files.receipts || [], files.fuelReceipt?.[0]);
  }

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE)
  async findAll(@Query() dto: FindDailyClosuresDto) {
    return this.dailyClosuresService.findAll(dto);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async findById(@Param('id') id: string) {
    return this.dailyClosuresService.getDetailWithSignedUrls(id);
  }
}
