import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { NetworkConnectivityModule } from '../network-connectivity/network-connectivity.module';
import { routerOsClientFactoryProvider } from '../network/routeros/routeros-client-factory';

import { OltEntity } from './entities/olt.entity';
import { OltRolePermissionEntity } from './entities/olt-role-permission.entity';
import { OltInterfaceEntity } from './entities/olt-interface.entity';
import { VlanEntity } from './entities/vlan.entity';
import { OltInterfaceVlanEntity } from './entities/olt-interface-vlan.entity';
import { OltSpeedProfileEntity } from './entities/olt-speed-profile.entity';
import { OnuTypeEntity } from './entities/onu-type.entity';
import { Tr069NetworkEntity } from './entities/tr069-network.entity';
import { OnuEntity } from './entities/onu.entity';
import { OnuServiceConfigEntity } from './entities/onu-service-config.entity';
import { OltMetricEntity } from './entities/olt-metric.entity';
import { NetworkNodeEntity } from '../network/entities/network-node.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { CompanyProfileEntity } from '../company/entities/company-profile.entity';
import { PlanEntity } from '../plans/entities/plan.entity';

import { ZteC320Driver } from './drivers/zte-c320.driver';
import { HuaweiMa5800Driver } from './drivers/huawei-ma5800.driver';
import { HiosoDriver } from './drivers/hioso.driver';
import { HsgqDriver } from './drivers/hsgq.driver';
import { OltDriverRegistry } from './drivers/olt-driver.registry';

import { OltManagementService } from './services/olt-management.service';
import { OltCatalogsService } from './services/olt-catalogs.service';
import { OltNatManagerService } from './services/olt-nat-manager.service';
import { OnuManagementService } from './services/onu-management.service';
import { OltMonitoringService } from './services/olt-monitoring.service';
import { OltPermissionGuard } from './guards/olt-permission.guard';
import { OltController } from './olt.controller';
import { OnuController } from './onu.controller';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      OltEntity,
      OltRolePermissionEntity,
      OltInterfaceEntity,
      VlanEntity,
      OltInterfaceVlanEntity,
      OltSpeedProfileEntity,
      OnuTypeEntity,
      Tr069NetworkEntity,
      OnuEntity,
      OnuServiceConfigEntity,
      OltMetricEntity,
      NetworkNodeEntity,
      ContractEntity,
      CompanyProfileEntity,
      PlanEntity,
    ]),
    NetworkConnectivityModule,
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [OltController, OnuController],
  providers: [
    ZteC320Driver,
    HuaweiMa5800Driver,
    HiosoDriver,
    HsgqDriver,
    OltDriverRegistry,
    OltManagementService,
    OltCatalogsService,
    OltNatManagerService,
    OnuManagementService,
    OltMonitoringService,
    OltPermissionGuard,
    routerOsClientFactoryProvider,
  ],
  exports: [
    OltManagementService,
    OltCatalogsService,
    OltNatManagerService,
    OnuManagementService,
    OltMonitoringService,
    OltDriverRegistry,
    ZteC320Driver,
  ],
})
export class OltModule {}
