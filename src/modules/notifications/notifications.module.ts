import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { JwtModule } from '@nestjs/jwt';
import { StaffNotificationEntity } from './entities/staff-notification.entity';
import { StaffNotificationService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { StaffEventsListener } from './listeners/staff-events.listener';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([StaffNotificationEntity]),
    JwtModule.register({}),
  ],
  controllers: [NotificationsController],
  providers: [StaffNotificationService, NotificationsGateway, StaffEventsListener],
  exports: [StaffNotificationService, NotificationsGateway],
})
export class NotificationsModule {}
