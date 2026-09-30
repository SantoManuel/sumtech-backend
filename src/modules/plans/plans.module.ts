import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
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
    TenantTypeOrmModule.forFeature([PlanEntity, ServiceFeeEntity]),
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [PlansController, ServiceFeesController],
  providers: [PlansService, ServiceFeesService],
  exports: [PlansService, ServiceFeesService],
})
export class PlansModule {}
