import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PosService } from './pos.service';
import { CheckoutDto } from './dto/checkout.dto';
import { CollectInvoicesDto } from './dto/collect-invoices.dto';
import { OpenCashRegisterDto, CloseCashRegisterDto } from './dto/cash-register.dto';
import { FindCashRegistersDto } from './dto/find-cash-registers.dto';
import { CreateCashStationDto, UpdateCashStationDto } from './dto/cash-station.dto';
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

  // Historial de turnos (abiertos y cerrados). Un CAJERO queda forzado a ver
  // solo los suyos; ADMIN/GERENTE pueden ver de todos y filtrar por cajero.
  @Get('cash-registers')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async findAllCashRegisters(
    @Query() dto: FindCashRegistersDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    const isPrivileged = roles?.includes(Role.ADMIN) || roles?.includes(Role.GERENTE);
    return this.posService.findAllCashRegisters(dto, isPrivileged ? undefined : userId);
  }

  @Get('cash-registers/:id/summary')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async getShiftSummary(@Param('id') id: string) {
    return this.posService.getShiftSummary(id);
  }

  // Reporte agregado de caja (por cajero/método de pago) para /dashboard/reportes.
  // Solo ADMIN/GERENTE — a diferencia del historial, aquí sí se comparan cajeros entre sí.
  @Get('reports/caja')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getCajaReport(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.posService.getCajaReport(startDate, endDate, branchId);
  }

  // Cajas físicas (Fase 5) — lectura abierta al staff (selección de caja al
  // abrir turno, formulario de empleados); alta/edición solo ADMIN/GERENTE.
  @Get('cash-stations')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM)
  async findAllCashStations(@Query('branchId') branchId?: string, @Query('activeOnly') activeOnly?: string) {
    return this.posService.findAllCashStations(branchId, activeOnly === 'true');
  }

  @Post('cash-stations')
  @Roles(Role.ADMIN, Role.GERENTE)
  async createCashStation(@Body() dto: CreateCashStationDto) {
    return this.posService.createCashStation(dto);
  }

  @Patch('cash-stations/:id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async updateCashStation(@Param('id') id: string, @Body() dto: UpdateCashStationDto) {
    return this.posService.updateCashStation(id, dto);
  }
}
