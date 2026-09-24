import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';
import { ServiceFeesService } from './service-fees.service';
import { ServiceFeesController } from './service-fees.controller';
import { PlanEntity } from './entities/plan.entity';
import { ServiceFeeEntity } from './entities/service-fee.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlanEntity, ServiceFeeEntity]),
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [PlansController, ServiceFeesController],
  providers: [PlansService, ServiceFeesService],
  exports: [PlansService, ServiceFeesService],
})
export class PlansModule {}
