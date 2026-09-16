import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { CrmService } from './crm.service';
import { CrmCatalogsService } from './crm-catalogs.service';
import { CrmSchedulerService } from './crm-scheduler.service';
import { CrmController } from './crm.controller';
import { OpportunityEntity } from './entities/opportunity.entity';
import { InteractionEntity } from './entities/interaction.entity';
import { SubscriptionStatusEntity } from './entities/subscription-status.entity';
import { NextActionEntity } from './entities/next-action.entity';
import { LossReasonEntity } from './entities/loss-reason.entity';
import { RoundRobinCursorEntity } from './entities/round-robin-cursor.entity';
import { OpportunityStateHistoryEntity } from './entities/opportunity-state-history.entity';
import { SlaPolicyEntity } from './entities/sla-policy.entity';
import { SatisfactionSurveyEntity } from './entities/satisfaction-survey.entity';
import { UserEntity } from '../users/entities/user.entity';
import { RoleEntity } from '../users/entities/role.entity';
import { CrmSaleListener } from './listeners/crm-sale.listener';
import { UsersModule } from '../users/users.module';
import { ClientsModule } from '../clients/clients.module';
import { AiChatbotClientModule } from '../ai-chatbot/ai-chatbot-client.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OpportunityEntity,
      InteractionEntity,
      SubscriptionStatusEntity,
      NextActionEntity,
      LossReasonEntity,
      RoundRobinCursorEntity,
      OpportunityStateHistoryEntity,
      SlaPolicyEntity,
      SatisfactionSurveyEntity,
      UserEntity,
      RoleEntity,
    ]),
    UsersModule,
    ClientsModule,
    AiChatbotClientModule,
    MailModule,
    JwtModule.register({}),
  ],
  controllers: [CrmController],
  providers: [CrmService, CrmCatalogsService, CrmSchedulerService, CrmSaleListener],
  exports: [CrmService, CrmCatalogsService],
})
export class CrmModule {}
