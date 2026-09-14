import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { DailyClosuresService } from './daily-closures.service';
import { DailyClosuresController } from './daily-closures.controller';
import { DailyClosureEntity } from './entities/daily-closure.entity';
import { DailyClosureExpenseEntity } from './entities/daily-closure-expense.entity';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DailyClosureEntity, DailyClosureExpenseEntity]),
    StorageModule,
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [DailyClosuresController],
  providers: [DailyClosuresService],
  exports: [DailyClosuresService],
})
export class DailyClosuresModule {}
