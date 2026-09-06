import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { EquipmentMovementService } from './services/equipment-movement.service';
import { ConsumableStockService } from './services/consumable-stock.service';
import { DispatchService } from './services/dispatch.service';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { AssignSerialDto } from './dto/assign-serial.dto';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/create-warehouse.dto';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import { RecordMovementDto } from './dto/record-movement.dto';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { CreateDispatchDto, AddDispatchLineDto, RespondDispatchDto, FilterDispatchDto } from './dto/dispatch.dto';
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
/** Catálogo completo (precios, stock global, categorías, almacenes): un técnico no lo necesita — solo ve lo suyo vía /technicians/:employeeId/*. */
const CATALOG_READ_ROLES = [Role.ADMIN, Role.GERENTE, Role.CAJERO];

@Controller('inventory')
@UseGuards(AuthGuard, RolesGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly equipmentMovementService: EquipmentMovementService,
    private readonly consumableStockService: ConsumableStockService,
    private readonly dispatchService: DispatchService,
  ) {}

  private isAdminRole(roles: string[] | undefined): boolean {
    return !!roles?.some((r) => ADMIN_ROLES.includes(r as Role));
  }

  /** Un técnico solo puede consultar SU PROPIO inventario/despachos, nunca los de otro compañero. */
  private assertOwnEmployeeIdOrAdmin(targetEmployeeId: string, currentEmployeeId: string, roles: string[]): void {
    if (this.isAdminRole(roles)) return;
    if (targetEmployeeId !== currentEmployeeId) {
      throw new ForbiddenException('Solo puedes consultar tu propio inventario');
    }
  }

  // ---------- Productos ----------

  @Get('products')
  @Roles(...CATALOG_READ_ROLES)
  async findAllProducts(@Query() filterDto: FilterProductDto) {
    return this.inventoryService.findAllProducts(filterDto);
  }

  @Get('products/low-stock')
  @Roles(Role.ADMIN, Role.GERENTE)
  async findLowStock() {
    return this.inventoryService.findLowStock();
  }

  @Get('products/:id')
  @Roles(...CATALOG_READ_ROLES)
  async findProductById(@Param('id') id: string) {
    return this.inventoryService.findProductById(id);
  }

  // ---------- Búsqueda unificada (escaneo rápido) ----------

  @Get('lookup')
  @Roles(...CATALOG_READ_ROLES)
  async lookupByCode(@Query('code') code: string) {
    return this.inventoryService.lookupByCode(code);
  }

  @Post('products')
  @Roles(...ADMIN_ROLES)
  async createProduct(@Body() createProductDto: CreateProductDto) {
    return this.inventoryService.createProduct(createProductDto);
  }

  @Patch('products/:id')
  @Roles(...ADMIN_ROLES)
  async updateProduct(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto) {
    return this.inventoryService.updateProduct(id, updateProductDto);
  }

  // ---------- Proveedores ----------

  @Get('suppliers')
  @Roles(...CATALOG_READ_ROLES)
  async findSuppliers(@Query('search') search?: string, @Query('isActive') isActive?: string) {
    const activeFilter = isActive !== undefined ? isActive === 'true' : undefined;
    return this.inventoryService.findSuppliers(search, activeFilter);
  }

  @Get('suppliers/:id')
  @Roles(...CATALOG_READ_ROLES)
  async findSupplierById(@Param('id') id: string) {
    return this.inventoryService.findSupplierById(id);
  }

  @Post('suppliers')
  @Roles(...ADMIN_ROLES)
  async createSupplier(@Body() dto: CreateSupplierDto) {
    return this.inventoryService.createSupplier(dto);
  }

  @Patch('suppliers/:id')
  @Roles(...ADMIN_ROLES)
  async updateSupplier(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.inventoryService.updateSupplier(id, dto);
  }

  // ---------- Ingreso/salida manual de almacén ----------

  @Post('movements')
  @Roles(...ADMIN_ROLES)
  async recordMovement(@CurrentUser('sub') userId: string, @Body() dto: RecordMovementDto) {
    return this.inventoryService.recordMovement(dto, userId);
  }

  // ---------- Almacenes ----------

  @Get('warehouses')
  @Roles(...CATALOG_READ_ROLES)
  async findWarehouses() {
    return this.inventoryService.findWarehouses();
  }

  @Get('warehouses/:id')
  @Roles(...CATALOG_READ_ROLES)
  async findWarehouseById(@Param('id') id: string) {
    return this.inventoryService.findWarehouseById(id);
  }

  @Post('warehouses')
  @Roles(...ADMIN_ROLES)
  async createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.inventoryService.createWarehouse(dto);
  }

  @Patch('warehouses/:id')
  @Roles(...ADMIN_ROLES)
  async updateWarehouse(@Param('id') id: string, @Body() dto: UpdateWarehouseDto) {
    return this.inventoryService.updateWarehouse(id, dto);
  }

  // ---------- Categorías ----------

  @Get('categories')
  @Roles(...CATALOG_READ_ROLES)
  async findAllCategories() {
    return this.inventoryService.findAllCategories();
  }

  @Post('categories')
  @Roles(...ADMIN_ROLES)
  async createCategory(@Body() dto: CreateCategoryDto) {
    return this.inventoryService.createCategory(dto);
  }

  @Patch('categories/:id')
  @Roles(...ADMIN_ROLES)
  async updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.inventoryService.updateCategory(id, dto);
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
  async findEquipment(
    @Query() filterDto: FilterSerialDto,
    @CurrentUser('employeeId') currentEmployeeId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    // Un no-admin nunca puede listar el equipo de otro empleado ni el de todo el
    // almacén: se fuerza su propio employeeId sin importar qué haya enviado.
    if (!this.isAdminRole(roles)) {
      filterDto.employeeId = currentEmployeeId;
    }
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
  async getTechnicianEquipment(
    @Param('employeeId') employeeId: string,
    @CurrentUser('employeeId') currentEmployeeId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    this.assertOwnEmployeeIdOrAdmin(employeeId, currentEmployeeId, roles);
    return this.equipmentMovementService.getTechnicianEquipment(employeeId);
  }

  @Get('technicians/:employeeId/tools')
  @Roles(...READ_ROLES)
  async getTechnicianTools(
    @Param('employeeId') employeeId: string,
    @CurrentUser('employeeId') currentEmployeeId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    this.assertOwnEmployeeIdOrAdmin(employeeId, currentEmployeeId, roles);
    return this.equipmentMovementService.getTechnicianTools(employeeId);
  }

  @Get('technicians/:employeeId/stock')
  @Roles(...READ_ROLES)
  async getTechnicianStock(
    @Param('employeeId') employeeId: string,
    @CurrentUser('employeeId') currentEmployeeId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    this.assertOwnEmployeeIdOrAdmin(employeeId, currentEmployeeId, roles);
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

  // ---------- Despacho por lotes (Manifiesto de Carga) ----------

  @Get('dispatches')
  @Roles(...READ_ROLES)
  async findAllDispatches(
    @Query() filterDto: FilterDispatchDto,
    @CurrentUser('employeeId') currentEmployeeId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    // Un técnico nunca ve el manifiesto de otro compañero, sin importar qué
    // technicianId haya enviado en la consulta.
    if (!this.isAdminRole(roles)) {
      filterDto.technicianId = currentEmployeeId;
    }
    return this.dispatchService.findAll(filterDto);
  }

  @Get('dispatches/:id')
  @Roles(...READ_ROLES)
  async findDispatchById(@Param('id') id: string) {
    return this.dispatchService.findById(id);
  }

  @Post('dispatches')
  @Roles(...ADMIN_ROLES)
  async createDispatch(@CurrentUser('sub') userId: string, @Body() dto: CreateDispatchDto) {
    return this.dispatchService.createDraft(dto, userId);
  }

  @Post('dispatches/:id/lines')
  @Roles(...ADMIN_ROLES)
  async addDispatchLine(@Param('id') id: string, @Body() dto: AddDispatchLineDto) {
    return this.dispatchService.addLine(id, dto);
  }

  @Delete('dispatches/:id/lines/:lineId')
  @Roles(...ADMIN_ROLES)
  async removeDispatchLine(@Param('id') id: string, @Param('lineId') lineId: string) {
    await this.dispatchService.removeLine(id, lineId);
    return { success: true };
  }

  @Post('dispatches/:id/confirm')
  @Roles(...ADMIN_ROLES)
  async confirmDispatch(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.dispatchService.confirmDispatch(id, userId);
  }

  @Post('dispatches/:id/respond')
  @Roles(...FIELD_ROLES)
  async respondToDispatch(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentUser('roles') roles: string[],
    @Body() dto: RespondDispatchDto,
  ) {
    if (!this.isAdminRole(roles)) {
      const dispatch = await this.dispatchService.findById(id);
      if (dispatch.technicianId !== employeeId) {
        throw new ForbiddenException('Solo el técnico asignado a este despacho puede responderlo');
      }
    }
    return this.dispatchService.respondToDispatch(id, dto, userId);
  }
}
