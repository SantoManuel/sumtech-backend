import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { EquipmentMovementService } from './services/equipment-movement.service';
import { ConsumableStockService } from './services/consumable-stock.service';
import { CreateProductDto } from './dto/create-product.dto';
import { AssignSerialDto } from './dto/assign-serial.dto';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { RecordMovementDto } from './dto/record-movement.dto';
import { FilterProductDto, FilterSerialDto } from './dto/filter-inventory.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  AssignTechnicianDto,
  InstallAtClientDto,
  UninstallDto,
  ReturnToWarehouseDto,
  TransferTechnicianDto,
  ReportDamageDto,
  SendToRepairDto,
  ReturnFromRepairDto,
  RetireEquipmentDto,
  AdjustEquipmentDto,
} from './dto/equipment-actions.dto';
import {
  IngresoConsumableDto,
  SalidaATecnicoDto,
  ConsumoInstalacionDto,
  DevolucionAlmacenConsumableDto,
  AjusteConsumableDto,
} from './dto/consumable-stock.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

const READ_ROLES = [Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO];
const FIELD_ROLES = [Role.ADMIN, Role.GERENTE, Role.TECNICO];
const ADMIN_ROLES = [Role.ADMIN, Role.GERENTE];

@Controller('inventory')
@UseGuards(AuthGuard, RolesGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly equipmentMovementService: EquipmentMovementService,
    private readonly consumableStockService: ConsumableStockService,
  ) {}

  // ---------- Productos ----------

  @Get('products')
  @Roles(...READ_ROLES)
  async findAllProducts(@Query() filterDto: FilterProductDto) {
    return this.inventoryService.findAllProducts(filterDto, filterDto.category);
  }

  @Get('products/low-stock')
  @Roles(Role.ADMIN, Role.GERENTE)
  async findLowStock() {
    return this.inventoryService.findLowStock();
  }

  @Get('products/:id')
  @Roles(...READ_ROLES)
  async findProductById(@Param('id') id: string) {
    return this.inventoryService.findProductById(id);
  }

  @Post('products')
  @Roles(...ADMIN_ROLES)
  async createProduct(@Body() createProductDto: CreateProductDto) {
    return this.inventoryService.createProduct(createProductDto);
  }

  // ---------- Ingreso/salida manual de almacén ----------

  @Post('movements')
  @Roles(...ADMIN_ROLES)
  async recordMovement(@CurrentUser('sub') userId: string, @Body() dto: RecordMovementDto) {
    return this.inventoryService.recordMovement(dto, userId);
  }

  // ---------- Almacenes ----------

  @Get('warehouses')
  @Roles(...READ_ROLES)
  async findWarehouses() {
    return this.inventoryService.findWarehouses();
  }

  @Post('warehouses')
  @Roles(...ADMIN_ROLES)
  async createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.inventoryService.createWarehouse(dto);
  }

  // ---------- Seriales (legacy, se mantiene por compatibilidad) ----------

  @Get('serials')
  @Roles(...READ_ROLES)
  async findSerials(@Query('productId') productId?: string, @Query('status') status?: string) {
    return this.inventoryService.findSerials(productId, status);
  }

  @Post('serials/assign')
  @Roles(...READ_ROLES)
  async assignSerial(@Body() assignSerialDto: AssignSerialDto) {
    return this.inventoryService.assignSerial(assignSerialDto);
  }

  // ---------- Trazabilidad de equipos (fuente de verdad) ----------

  @Get('equipment')
  @Roles(...READ_ROLES)
  async findEquipment(@Query() filterDto: FilterSerialDto) {
    return this.equipmentMovementService.findEquipment(filterDto);
  }

  @Get('equipment/:id')
  @Roles(...READ_ROLES)
  async findEquipmentById(@Param('id') id: string) {
    return this.equipmentMovementService.findById(id);
  }

  @Get('equipment/:id/movements')
  @Roles(...READ_ROLES)
  async getEquipmentKardex(@Param('id') id: string, @Query() paginationDto: PaginationDto) {
    return this.equipmentMovementService.getKardex(id, paginationDto);
  }

  @Post('equipment/:id/assign-technician')
  @Roles(...FIELD_ROLES)
  async assignTechnician(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: AssignTechnicianDto,
  ) {
    return this.equipmentMovementService.asignarATecnico(id, dto, userId);
  }

  @Post('equipment/:id/install')
  @Roles(...FIELD_ROLES)
  async installAtClient(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() dto: InstallAtClientDto) {
    return this.equipmentMovementService.instalarEnCliente(id, dto, userId);
  }

  @Post('equipment/:id/uninstall')
  @Roles(...FIELD_ROLES)
  async uninstall(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() dto: UninstallDto) {
    return this.equipmentMovementService.desinstalar(id, dto, userId);
  }

  @Post('equipment/:id/return-to-warehouse')
  @Roles(...FIELD_ROLES)
  async returnToWarehouse(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: ReturnToWarehouseDto,
  ) {
    return this.equipmentMovementService.devolverAlmacen(id, userId, dto?.warehouseId);
  }

  @Post('equipment/:id/transfer-technician')
  @Roles(...FIELD_ROLES)
  async transferTechnician(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: TransferTechnicianDto,
  ) {
    return this.equipmentMovementService.transferirATecnico(id, dto, userId);
  }

  @Post('equipment/:id/report-damage')
  @Roles(...FIELD_ROLES)
  async reportDamage(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() dto: ReportDamageDto) {
    return this.equipmentMovementService.reportarDano(id, dto, userId);
  }

  @Post('equipment/:id/send-to-repair')
  @Roles(...FIELD_ROLES)
  async sendToRepair(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() dto: SendToRepairDto) {
    return this.equipmentMovementService.enviarAReparacion(id, dto, userId);
  }

  @Post('equipment/:id/return-from-repair')
  @Roles(...ADMIN_ROLES)
  async returnFromRepair(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: ReturnFromRepairDto,
  ) {
    return this.equipmentMovementService.retornarDeReparacion(id, dto, userId);
  }

  @Post('equipment/:id/retire')
  @Roles(...ADMIN_ROLES)
  async retire(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() dto: RetireEquipmentDto) {
    return this.equipmentMovementService.darDeBaja(id, dto, userId);
  }

  @Post('equipment/:id/adjust')
  @Roles(...ADMIN_ROLES)
  async adjustEquipment(@Param('id') id: string, @CurrentUser('sub') userId: string, @Body() dto: AdjustEquipmentDto) {
    return this.equipmentMovementService.ajusteEquipo(id, dto, userId);
  }

  // ---------- Vista "mi inventario" del técnico ----------

  @Get('technicians')
  @Roles(...FIELD_ROLES)
  async listTechnicians() {
    return this.inventoryService.listTechnicians();
  }

  @Get('technicians/:employeeId/equipment')
  @Roles(...READ_ROLES)
  async getTechnicianEquipment(@Param('employeeId') employeeId: string) {
    return this.equipmentMovementService.getTechnicianEquipment(employeeId);
  }

  @Get('technicians/:employeeId/stock')
  @Roles(...READ_ROLES)
  async getTechnicianStock(@Param('employeeId') employeeId: string) {
    return this.consumableStockService.getTechnicianStock(employeeId);
  }

  // ---------- Materiales a granel (consumibles) ----------

  @Post('consumables/entry')
  @Roles(...ADMIN_ROLES)
  async consumableEntry(@CurrentUser('sub') userId: string, @Body() dto: IngresoConsumableDto) {
    return this.consumableStockService.ingresoAlmacen(dto, userId);
  }

  @Post('consumables/dispatch')
  @Roles(...ADMIN_ROLES)
  async consumableDispatch(@CurrentUser('sub') userId: string, @Body() dto: SalidaATecnicoDto) {
    return this.consumableStockService.salidaATecnico(dto, userId);
  }

  @Post('consumables/consume')
  @Roles(...FIELD_ROLES)
  async consumableConsume(@CurrentUser('sub') userId: string, @Body() dto: ConsumoInstalacionDto) {
    return this.consumableStockService.consumoEnInstalacion(dto, userId);
  }

  @Post('consumables/return')
  @Roles(...FIELD_ROLES)
  async consumableReturn(@CurrentUser('sub') userId: string, @Body() dto: DevolucionAlmacenConsumableDto) {
    return this.consumableStockService.devolverAlmacen(dto, userId);
  }

  @Post('consumables/adjust')
  @Roles(...ADMIN_ROLES)
  async consumableAdjust(@CurrentUser('sub') userId: string, @Body() dto: AjusteConsumableDto) {
    return this.consumableStockService.ajustar(dto, userId);
  }
}
