import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { PosService } from './pos.service';
import { CheckoutDto } from './dto/checkout.dto';
import { CollectInvoicesDto } from './dto/collect-invoices.dto';
import { OpenCashRegisterDto, CloseCashRegisterDto } from './dto/cash-register.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('pos')
@UseGuards(AuthGuard, RolesGuard)
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Post('checkout')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async checkout(@CurrentUser('sub') userId: string, @Body() checkoutDto: CheckoutDto) {
    return this.posService.checkout(userId, checkoutDto);
  }

  @Post('collect-invoices')
  // TECNICO habilitado para el "Cobro Exprés" en campo — cobra facturas
  // PENDING_PAYMENT ya generadas (nunca crea cargos nuevos), sin caja abierta
  // (collectInvoices() ya tolera cashRegisterId ausente).
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO)
  async collectInvoices(@CurrentUser('sub') userId: string, @Body() dto: CollectInvoicesDto) {
    return this.posService.collectInvoices(userId, dto);
  }

  @Get('sales/:id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async findSaleById(@Param('id') id: string) {
    return this.posService.findSaleById(id);
  }

  @Post('cash-registers/open')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async openRegister(@CurrentUser('sub') userId: string, @Body() dto: OpenCashRegisterDto) {
    return this.posService.openCashRegister(userId, dto);
  }

  @Post('cash-registers/:id/close')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async closeRegister(@Param('id') id: string, @Body() dto: CloseCashRegisterDto) {
    return this.posService.closeCashRegister(id, dto);
  }

  @Get('cash-registers/active')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async getActiveRegister(@CurrentUser('sub') userId: string) {
    return this.posService.getActiveRegister(userId);
  }

  @Get('cash-registers/:id/summary')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async getShiftSummary(@Param('id') id: string) {
    return this.posService.getShiftSummary(id);
  }
}
