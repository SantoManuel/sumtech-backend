import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { BillingSettingsService } from './billing-settings.service';
import { MorosidadService, GetDelinquentsQueryDto } from './morosidad.service';
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

  // Lectura abierta también a CAJERO/TECNICO: necesitan conocer el monto del
  // cargo de reconexión (y, en el futuro, el tope de descuento) para informar
  // al cliente en el POS/Cobro Exprés antes de cobrar — la edición (PATCH)
  // sigue restringida a ADMIN/GERENTE vía el @Roles de clase.
  @Get('settings')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO)
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

  @Get('delinquents')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async getDelinquents(@Query() query: GetDelinquentsQueryDto) {
    return this.morosidadService.getDelinquents(query);
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
