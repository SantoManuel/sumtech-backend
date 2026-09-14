import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PublicService } from './public.service';
import { PublicChatService } from './public-chat.service';
import { RequestLeadDto } from './dto/request-lead.dto';
import { StartPublicChatDto, SendPublicChatMessageDto } from './dto/public-chat.dto';
import { Public } from '../../common/decorators/public.decorator';
import { SpanishThrottlerGuard } from '../../common/guards/spanish-throttler.guard';

@Controller('public')
@Public()
export class PublicController {
  constructor(
    private readonly publicService: PublicService,
    private readonly publicChatService: PublicChatService,
  ) {}

  @Get('plans')
  async getPlans() {
    return this.publicService.getPublicPlans();
  }

  @Get('plans/featured')
  async getFeatured() {
    return this.publicService.getFeaturedPlans();
  }

  @Post('leads')
  async createLead(@Body() dto: RequestLeadDto) {
    return this.publicService.createLead(dto);
  }

  // Widget de chat público del landing (sumtech_landingPage_TeleAzua, "/").
  // Rate limit propio: sin este guard, cualquiera podría disparar llamadas
  // ilimitadas a Chatbot_sumtech (costo de IA) sin ninguna autenticación.
  @Post('chat/start')
  @UseGuards(SpanishThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  async startChat(@Body() dto: StartPublicChatDto) {
    return this.publicChatService.startSession(dto);
  }

  @Post('chat/message')
  @UseGuards(SpanishThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  async sendChatMessage(@Body() dto: SendPublicChatMessageDto) {
    return this.publicChatService.sendMessage(dto.sessionId, dto.message);
  }
}
