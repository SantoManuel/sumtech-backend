import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { ContractEntity } from '../clients/entities/contract.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ZoneEntity,
      NetworkNodeEntity,
      NetworkAccessEntity,
      ProvisioningAuditLogEntity,
      ContractEntity,
    ]),
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [ZonesController, NetworkNodesController, NetworkAccessController, NetworkAuditLogController],
  providers: [
    ZonesService,
    NetworkNodesService,
    NetworkProvisioningService,
    ManualProvisioningAdapter,
    RouterOsProvisioningAdapter,
    NetworkProvisioningPortRegistry,
    routerOsClientFactoryProvider,
    NetworkContractCreatedListener,
    NetworkContractStatusListener,
    NetworkContractPlanChangedListener,
    NetworkPlanSpeedChangedListener,
    RouterOsShadowSyncService,
  ],
  exports: [ZonesService, NetworkNodesService, NetworkProvisioningService, RouterOsShadowSyncService],
})
export class NetworkModule {}
