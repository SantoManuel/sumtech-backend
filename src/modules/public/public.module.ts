import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../../common/tenancy/tenant-typeorm.module';
import { PublicService } from './public.service';
import { PublicChatService } from './public-chat.service';
import { PublicGpsService } from './public-gps.service';
import { PublicSurveyService } from './public-survey.service';
import { PublicController } from './public.controller';
import { PlansModule } from '../plans/plans.module';
import { CrmModule } from '../crm/crm.module';
import { CompanyModule } from '../company/company.module';
import { NetworkModule } from '../network/network.module';
import { GeographyModule } from '../geography/geography.module';
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
    CompanyModule,
    NetworkModule,
    GeographyModule,
    AiChatbotClientModule,
    TenantTypeOrmModule.forFeature([
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
