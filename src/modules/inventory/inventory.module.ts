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
import { EquipmentMovementService } from './services/equipment-movement.service';
import { ConsumableStockService } from './services/consumable-stock.service';
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
      EmployeeEntity,
    ]),
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [InventoryController],
  providers: [InventoryService, EquipmentMovementService, ConsumableStockService],
  exports: [InventoryService, EquipmentMovementService, ConsumableStockService],
})
export class InventoryModule {}
