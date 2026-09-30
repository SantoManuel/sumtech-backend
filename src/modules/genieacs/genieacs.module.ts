import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { JwtModule } from '@nestjs/jwt';
import { GenieAcsDeviceEntity } from './entities/genieacs-device.entity';
import { GenieAcsAuditLogEntity } from './entities/genieacs-audit-log.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { GenieAcsDeviceResolverService } from './genieacs-device-resolver.service';
import { GenieAcsWifiService } from './genieacs-wifi.service';
import { GenieAcsMonitoringService } from './genieacs-monitoring.service';
import { GenieAcsReconciliationService } from './genieacs-reconciliation.service';
import { CpeParameterMapper } from './services/cpe-parameter-mapper';
import { CpeConfiguratorService } from './services/cpe-configurator.service';
import { GenieAcsController } from './genieacs.controller';
import { GenieAcsWebhookController } from './controllers/genieacs-webhook.controller';
import { GenieAcsDevicesController } from './controllers/genieacs-devices.controller';
import { genieAcsClientFactoryProvider } from './genieacs-client-factory';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      GenieAcsDeviceEntity,
      GenieAcsAuditLogEntity,
      SerialNumberEntity,
      ContractEntity,
      TicketEntity,
    ]),
    TicketsModule,
    JwtModule.register({}),
  ],
  controllers: [
    GenieAcsController,
    GenieAcsWebhookController,
    GenieAcsDevicesController,
  ],
  providers: [
    GenieAcsDeviceResolverService,
    GenieAcsWifiService,
    GenieAcsMonitoringService,
    GenieAcsReconciliationService,
    CpeParameterMapper,
    CpeConfiguratorService,
    genieAcsClientFactoryProvider,
  ],
  exports: [
    GenieAcsDeviceResolverService,
    GenieAcsWifiService,
    GenieAcsMonitoringService,
    CpeConfiguratorService,
    CpeParameterMapper,
  ],
})
export class GenieAcsModule {}
