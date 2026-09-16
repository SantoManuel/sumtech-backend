import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicService } from './public.service';
import { PublicChatService } from './public-chat.service';
import { PublicGpsService } from './public-gps.service';
import { PublicSurveyService } from './public-survey.service';
import { PublicController } from './public.controller';
import { PlansModule } from '../plans/plans.module';
import { CrmModule } from '../crm/crm.module';
import { AiChatbotClientModule } from '../ai-chatbot/ai-chatbot-client.module';
import { OpportunityEntity } from '../crm/entities/opportunity.entity';
import { SubscriptionStatusEntity } from '../crm/entities/subscription-status.entity';
import { NextActionEntity } from '../crm/entities/next-action.entity';
import { SatisfactionSurveyEntity } from '../crm/entities/satisfaction-survey.entity';
import { AddressGpsRequestEntity } from '../clients/entities/address-gps-request.entity';
import { AddressEntity } from '../clients/entities/address.entity';

@Module({
  imports: [
    PlansModule,
    CrmModule,
    AiChatbotClientModule,
    TypeOrmModule.forFeature([
      OpportunityEntity,
      SubscriptionStatusEntity,
      NextActionEntity,
      SatisfactionSurveyEntity,
      AddressGpsRequestEntity,
      AddressEntity,
    ]),
  ],
  controllers: [PublicController],
  providers: [PublicService, PublicChatService, PublicGpsService, PublicSurveyService],
})
export class PublicModule {}
