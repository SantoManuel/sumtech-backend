import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { JwtModule } from '@nestjs/jwt';
import { ZonesService } from './zones.service';
import { ZonesController } from './zones.controller';
import { NetworkNodesService } from './network-nodes.service';
import { NetworkNodesController } from './network-nodes.controller';
import { NetworkProvisioningService } from './network-provisioning.service';
import { NetworkProvisioningPortRegistry } from './network-provisioning-port.registry';
import { ManualProvisioningAdapter } from './manual-provisioning.adapter';
import { RouterOsProvisioningAdapter } from './routeros-provisioning.adapter';
import { NetworkAccessController } from './network-access.controller';
import { NetworkAuditLogController } from './network-audit-log.controller';
import { NetworkContractCreatedListener } from './listeners/contract-created.listener';
import { NetworkContractStatusListener } from './listeners/contract-status.listener';
import { NetworkContractPlanChangedListener } from './listeners/contract-plan-changed.listener';
import { NetworkPlanSpeedChangedListener } from './listeners/plan-speed-changed.listener';
import { RouterOsShadowSyncService } from './routeros-shadow-sync.service';
import { routerOsClientFactoryProvider } from './routeros/routeros-client-factory';
import { ZoneEntity } from './entities/zone.entity';
import { NetworkNodeEntity } from './entities/network-node.entity';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { ProvisioningAuditLogEntity } from './entities/provisioning-audit-log.entity';
import { DeviceLogEntity } from './entities/device-log.entity';
import { WireguardPeerEntity } from './entities/wireguard-peer.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { PlanEntity } from '../plans/entities/plan.entity';
import { PppManagementService } from './services/ppp-management.service';
import { NetworkAccessManagementController } from './network-access-management.controller';
import { UsersModule } from '../users/users.module';
import { NetworkConnectivityModule } from '../network-connectivity/network-connectivity.module';
import { OltModule } from '../olt/olt.module';
import { OltNativeProvisioningAdapter } from './olt-native-provisioning.adapter';
import { SuspensionPortalManagerService } from './services/suspension-portal-manager.service';

import { BullModule } from '@nestjs/bullmq';
import { NETWORK_OPS_QUEUE } from './network-ops.constants';
import { ServiceControlService } from './service-control.service';
import { NetworkOpsProcessor } from './network-ops.processor';
import { PendingOperationsController } from './pending-operations.controller';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      ZoneEntity,
      NetworkNodeEntity,
      NetworkAccessEntity,
      ProvisioningAuditLogEntity,
      DeviceLogEntity,
      WireguardPeerEntity,
      ContractEntity,
      PlanEntity,
    ]),
    BullModule.registerQueue({ name: NETWORK_OPS_QUEUE }),
    NetworkConnectivityModule,
    UsersModule,
    JwtModule.register({}),
    OltModule,
  ],
  controllers: [
    ZonesController,
    NetworkNodesController,
    NetworkAccessController,
    NetworkAccessManagementController,
    NetworkAuditLogController,
    PendingOperationsController,
  ],
  providers: [
    ZonesService,
    NetworkNodesService,
    NetworkProvisioningService,
    ServiceControlService,
    NetworkOpsProcessor,
    ManualProvisioningAdapter,
    RouterOsProvisioningAdapter,
    OltNativeProvisioningAdapter,
    NetworkProvisioningPortRegistry,
    routerOsClientFactoryProvider,
    NetworkContractCreatedListener,
    NetworkContractStatusListener,
    NetworkContractPlanChangedListener,
    NetworkPlanSpeedChangedListener,
    RouterOsShadowSyncService,
    PppManagementService,
    SuspensionPortalManagerService,
  ],
  exports: [
    ZonesService,
    NetworkNodesService,
    NetworkProvisioningService,
    ServiceControlService,
    NetworkProvisioningPortRegistry,
    RouterOsShadowSyncService,
    PppManagementService,
    SuspensionPortalManagerService,
  ],
})
export class NetworkModule {}
