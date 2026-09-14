import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GenieAcsDeviceEntity } from './entities/genieacs-device.entity';
import { GenieAcsAuditLogEntity } from './entities/genieacs-audit-log.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { GenieAcsDeviceResolverService } from './genieacs-device-resolver.service';
import { GenieAcsWifiService } from './genieacs-wifi.service';
import { genieAcsClientFactoryProvider } from './genieacs-client-factory';

@Module({
  imports: [TypeOrmModule.forFeature([GenieAcsDeviceEntity, GenieAcsAuditLogEntity, SerialNumberEntity])],
  providers: [GenieAcsDeviceResolverService, GenieAcsWifiService, genieAcsClientFactoryProvider],
  exports: [GenieAcsDeviceResolverService, GenieAcsWifiService],
})
export class GenieAcsModule {}
