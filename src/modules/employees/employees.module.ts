import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { JwtModule } from '@nestjs/jwt';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { EmployeeEntity } from './entities/employee.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([EmployeeEntity]),
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
