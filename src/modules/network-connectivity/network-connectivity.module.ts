import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NetworkNodeEntity } from '../network/entities/network-node.entity';
import { DeviceLogEntity } from '../network/entities/device-log.entity';
import { RouterOsRestTransport } from './transports/routeros-rest.transport';
import { RouterOsBinaryTransport } from './transports/routeros-binary.transport';
import { RouterOsSshTransport } from './transports/routeros-ssh.transport';
import { ReachabilityResolver } from './services/reachability-resolver.service';
import { WireguardManagerService } from './services/wireguard-manager.service';
import { WireGuardHubClient } from './services/wireguard-hub-client.service';
import { ConnectionTestService } from './services/connection-test.service';
import { DeviceHealthService } from './services/device-health.service';
import { DeviceOperationLogger } from './services/device-operation-logger.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([NetworkNodeEntity, DeviceLogEntity]),
  ],
  providers: [
    RouterOsRestTransport,
    RouterOsBinaryTransport,
    RouterOsSshTransport,
    ReachabilityResolver,
    WireguardManagerService,
    WireGuardHubClient,
    ConnectionTestService,
    DeviceHealthService,
    DeviceOperationLogger,
  ],
  exports: [
    RouterOsRestTransport,
    RouterOsBinaryTransport,
    RouterOsSshTransport,
    ReachabilityResolver,
    WireguardManagerService,
    WireGuardHubClient,
    ConnectionTestService,
    DeviceHealthService,
    DeviceOperationLogger,
  ],
})
export class NetworkConnectivityModule {}
