import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { JwtModule } from '@nestjs/jwt';
import { DailyClosuresService } from './daily-closures.service';
import { DailyClosuresController } from './daily-closures.controller';
import { DailyClosureEntity } from './entities/daily-closure.entity';
import { DailyClosureExpenseEntity } from './entities/daily-closure-expense.entity';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([DailyClosureEntity, DailyClosureExpenseEntity]),
    StorageModule,
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [DailyClosuresController],
  providers: [DailyClosuresService],
  exports: [DailyClosuresService],
})
export class DailyClosuresModule {}
