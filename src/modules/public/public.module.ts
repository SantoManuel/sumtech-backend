import { Module } from '@nestjs/common';
import { PublicService } from './public.service';
import { PublicController } from './public.controller';
import { PlansModule } from '../plans/plans.module';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [PlansModule, CrmModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
