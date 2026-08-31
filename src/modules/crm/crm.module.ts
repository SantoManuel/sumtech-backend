import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { CrmService } from './crm.service';
import { CrmController } from './crm.controller';
import { LeadEntity } from './entities/lead.entity';
import { InteractionEntity } from './entities/interaction.entity';
import { CrmSaleListener } from './listeners/crm-sale.listener';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LeadEntity, InteractionEntity]),
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [CrmController],
  providers: [CrmService, CrmSaleListener],
  exports: [CrmService],
})
export class CrmModule {}
