import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { GenieAcsController } from './genieacs.controller';
import { genieAcsClientFactoryProvider } from './genieacs-client-factory';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GenieAcsDeviceEntity, GenieAcsAuditLogEntity, SerialNumberEntity, ContractEntity, TicketEntity]),
    TicketsModule,
    JwtModule.register({}),
  ],
  controllers: [GenieAcsController],
  providers: [
    GenieAcsDeviceResolverService,
    GenieAcsWifiService,
    GenieAcsMonitoringService,
    GenieAcsReconciliationService,
    genieAcsClientFactoryProvider,
  ],
  exports: [GenieAcsDeviceResolverService, GenieAcsWifiService, GenieAcsMonitoringService],
})
export class GenieAcsModule {}
