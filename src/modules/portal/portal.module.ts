import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { JwtModule } from '@nestjs/jwt';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { AiChatbotClientModule } from '../ai-chatbot/ai-chatbot-client.module';
import { ClientEntity } from '../clients/entities/client.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { PlanEntity } from '../plans/entities/plan.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { EmployeeEntity } from '../employees/entities/employee.entity';
import { InteractionEntity } from '../crm/entities/interaction.entity';
import { DepositProofEntity } from './entities/deposit-proof.entity';
import { PlanChangeRequestEntity } from './entities/plan-change-request.entity';
import { ClientNotificationEntity } from './entities/client-notification.entity';
import { NotificationTemplateEntity } from './entities/notification-template.entity';
import { UsersModule } from '../users/users.module';
import { PosModule } from '../pos/pos.module';
import { StorageModule } from '../storage/storage.module';
import { GenieAcsModule } from '../genieacs/genieacs.module';
import { CompanyModule } from '../company/company.module';
import { InvoiceGeneratedListener } from './listeners/invoice-generated.listener';
import { ContractStatusListener } from './listeners/contract-status.listener';
import { PaymentReminderListener } from './listeners/payment-reminder.listener';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      ClientEntity,
      ContractEntity,
      PlanEntity,
      InvoiceEntity,
      SerialNumberEntity,
      TicketEntity,
      EmployeeEntity,
      InteractionEntity,
      DepositProofEntity,
      PlanChangeRequestEntity,
      ClientNotificationEntity,
      NotificationTemplateEntity,
    ]),
    UsersModule,
    PosModule,
    StorageModule,
    GenieAcsModule,
    CompanyModule,
    JwtModule.register({}),
    AiChatbotClientModule,
  ],
  controllers: [PortalController],
  providers: [PortalService, InvoiceGeneratedListener, ContractStatusListener, PaymentReminderListener],
  exports: [PortalService],
})
export class PortalModule {}
