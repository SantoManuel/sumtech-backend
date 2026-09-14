import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicService } from './public.service';
import { PublicChatService } from './public-chat.service';
import { PublicController } from './public.controller';
import { PlansModule } from '../plans/plans.module';
import { CrmModule } from '../crm/crm.module';
import { AiChatbotClientModule } from '../ai-chatbot/ai-chatbot-client.module';
import { LeadEntity } from '../crm/entities/lead.entity';

@Module({
  imports: [PlansModule, CrmModule, AiChatbotClientModule, TypeOrmModule.forFeature([LeadEntity])],
  controllers: [PublicController],
  providers: [PublicService, PublicChatService],
})
export class PublicModule {}
