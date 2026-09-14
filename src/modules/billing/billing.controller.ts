import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { BillingSettingsService } from './billing-settings.service';
import { MorosidadService } from './morosidad.service';
import { BillingCycleService } from './billing-cycle.service';
import { UpdateBillingSettingsDto } from './dto/update-billing-settings.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('billing')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.GERENTE)
export class BillingController {
  constructor(
    private readonly billingSettingsService: BillingSettingsService,
    private readonly morosidadService: MorosidadService,
    private readonly billingCycleService: BillingCycleService,
  ) {}

  @Get('settings')
  async getSettings() {
    return this.billingSettingsService.getSettings();
  }

  @Patch('settings')
  async updateSettings(@Body() dto: UpdateBillingSettingsDto) {
    return this.billingSettingsService.updateSettings(dto);
  }

  @Get('cartera-vencida')
  async getCarteraVencida() {
    return this.morosidadService.getCarteraVencida();
  }

  @Post('run-cycle')
  @Roles(Role.ADMIN)
  async runCycle() {
    const now = new Date();
    const billing = await this.billingCycleService.runBillingCycle(now);
    const morosidad = await this.morosidadService.runMorosidadCycle(now);
    return { billing, morosidad };
  }
}
