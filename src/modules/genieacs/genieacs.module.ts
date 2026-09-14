import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GenieAcsDeviceEntity } from './entities/genieacs-device.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { GenieAcsDeviceResolverService } from './genieacs-device-resolver.service';
import { genieAcsClientFactoryProvider } from './genieacs-client-factory';

@Module({
  imports: [TypeOrmModule.forFeature([GenieAcsDeviceEntity, SerialNumberEntity])],
  providers: [GenieAcsDeviceResolverService, genieAcsClientFactoryProvider],
  exports: [GenieAcsDeviceResolverService],
})
export class GenieAcsModule {}
