import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { ProductEntity } from './entities/product.entity';
import { SerialNumberEntity } from './entities/serial-number.entity';
import { StockMovementEntity } from './entities/stock-movement.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { EquipmentMovementEntity } from './entities/equipment-movement.entity';
import { StockItemEntity } from './entities/stock-item.entity';
import { CategoryEntity } from './entities/category.entity';
import { SupplierEntity } from './entities/supplier.entity';
import { DispatchEntity } from './entities/dispatch.entity';
import { DispatchLineEntity } from './entities/dispatch-line.entity';
import { EquipmentMovementService } from './services/equipment-movement.service';
import { ConsumableStockService } from './services/consumable-stock.service';
import { DispatchService } from './services/dispatch.service';
import { EmployeeEntity } from '../employees/entities/employee.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductEntity,
      SerialNumberEntity,
      StockMovementEntity,
      WarehouseEntity,
      EquipmentMovementEntity,
      StockItemEntity,
      CategoryEntity,
      SupplierEntity,
      DispatchEntity,
      DispatchLineEntity,
      EmployeeEntity,
    ]),
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [InventoryController],
  providers: [InventoryService, EquipmentMovementService, ConsumableStockService, DispatchService],
  exports: [InventoryService, EquipmentMovementService, ConsumableStockService, DispatchService],
})
export class InventoryModule {}
