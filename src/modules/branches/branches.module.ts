import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { JwtModule } from '@nestjs/jwt';
import { BranchEntity } from './entities/branch.entity';
import { BranchesService } from './branches.service';
import { BranchesController } from './branches.controller';

@Module({
  imports: [TenantTypeOrmModule.forFeature([BranchEntity]), JwtModule.register({})],
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
