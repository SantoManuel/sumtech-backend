import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from './tenant-typeorm.module';
import { TenancySmokeTestController } from './tenancy-smoke-test.controller';
import { ClientEntity } from '../../modules/clients/entities/client.entity';

@Module({
  imports: [TenantTypeOrmModule.forFeature([ClientEntity])],
  controllers: [TenancySmokeTestController],
})
export class TenancySmokeTestModule {}
