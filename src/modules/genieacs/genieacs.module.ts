import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { JwtModule } from '@nestjs/jwt';
import { GenieAcsDeviceEntity } from './entities/genieacs-device.entity';
import { GenieAcsAuditLogEntity } from './entities/genieacs-audit-log.entity';
import { CpeVendorParameterEntity } from './entities/cpe-vendor-parameter.entity';
import { CpeFirmwareEntity } from './entities/cpe-firmware.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { GenieAcsDeviceResolverService } from './genieacs-device-resolver.service';
import { GenieAcsWifiService } from './genieacs-wifi.service';
import { GenieAcsMonitoringService } from './genieacs-monitoring.service';
import { GenieAcsReconciliationService } from './genieacs-reconciliation.service';
import { CpeParameterMapper } from './services/cpe-parameter-mapper';
import { CpeConfiguratorService } from './services/cpe-configurator.service';
import { GenieAcsSnapshotService } from './services/genieacs-snapshot.service';
import { GenieAcsActivityLogService } from './services/genieacs-activity-log.service';
import { GenieAcsParameterWriteService } from './services/genieacs-parameter-write.service';
import { GenieAcsSectionWriteService } from './services/genieacs-section-write.service';
import { GenieAcsPortForwardingService } from './services/genieacs-port-forwarding.service';
import { GenieAcsDiagnosticsService } from './services/genieacs-diagnostics.service';
import { GenieAcsVendorParameterService } from './services/genieacs-vendor-parameter.service';
import { GenieAcsFirmwareService } from './services/genieacs-firmware.service';
import { StorageModule } from '../storage/storage.module';
import { GenieAcsController } from './genieacs.controller';
import { GenieAcsWebhookController } from './controllers/genieacs-webhook.controller';
import { GenieAcsDevicesController } from './controllers/genieacs-devices.controller';
import { GenieAcsVendorParametersController } from './controllers/genieacs-vendor-parameters.controller';
import { GenieAcsFirmwareController } from './controllers/genieacs-firmware.controller';
import { genieAcsClientFactoryProvider, GENIEACS_CLIENT } from './genieacs-client-factory';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      GenieAcsDeviceEntity,
      GenieAcsAuditLogEntity,
      CpeVendorParameterEntity,
      CpeFirmwareEntity,
      SerialNumberEntity,
      ContractEntity,
      TicketEntity,
    ]),
    TicketsModule,
    JwtModule.register({}),
    StorageModule,
  ],
  controllers: [
    GenieAcsController,
    GenieAcsWebhookController,
    GenieAcsDevicesController,
    GenieAcsVendorParametersController,
    GenieAcsFirmwareController,
  ],
  providers: [
    GenieAcsDeviceResolverService,
    GenieAcsWifiService,
    GenieAcsMonitoringService,
    GenieAcsReconciliationService,
    CpeParameterMapper,
    CpeConfiguratorService,
    GenieAcsSnapshotService,
    GenieAcsActivityLogService,
    GenieAcsParameterWriteService,
    GenieAcsSectionWriteService,
    GenieAcsPortForwardingService,
    GenieAcsDiagnosticsService,
    GenieAcsVendorParameterService,
    GenieAcsFirmwareService,
    genieAcsClientFactoryProvider,
  ],
  exports: [
    GenieAcsDeviceResolverService,
    GenieAcsWifiService,
    GenieAcsMonitoringService,
    CpeConfiguratorService,
    CpeParameterMapper,
    // GENIEACS_CLIENT -- lo necesita OnuCpeSyncReconciliationService (en
    // OltModule, que ya importa este módulo) para saltarse el reintento
    // completo si GenieACS no está configurado, sin pasar por
    // CpeConfiguratorService (que ya la usa internamente pero no la expone).
    GENIEACS_CLIENT,
  ],
})
export class GenieAcsModule {}
