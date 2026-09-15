import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PublicService } from './public.service';
import { PublicChatService } from './public-chat.service';
import { PublicGpsService } from './public-gps.service';
import { PublicSurveyService } from './public-survey.service';
import { RequestLeadDto } from './dto/request-lead.dto';
import { StartPublicChatDto, SendPublicChatMessageDto } from './dto/public-chat.dto';
import { SubmitGpsLocationDto } from './dto/submit-gps-location.dto';
import { SubmitSurveyDto } from './dto/submit-survey.dto';
import { Public } from '../../common/decorators/public.decorator';
import { SpanishThrottlerGuard } from '../../common/guards/spanish-throttler.guard';

@Controller('public')
@Public()
export class PublicController {
  constructor(
    private readonly publicService: PublicService,
    private readonly publicChatService: PublicChatService,
    private readonly publicGpsService: PublicGpsService,
    private readonly publicSurveyService: PublicSurveyService,
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

  // Enlace de "comparte tu ubicación GPS" enviado al celular del cliente al
  // crearlo — nunca expone datos del cliente, solo confirma si el token es
  // válido/ya usado antes de mostrar el botón de captura.
  @Get('gps-requests/:token')
  @UseGuards(SpanishThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async checkGpsRequest(@Param('token') token: string) {
    return this.publicGpsService.checkToken(token);
  }

  @Post('gps-requests/:token')
  @UseGuards(SpanishThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  async submitGpsRequest(@Param('token') token: string, @Body() dto: SubmitGpsLocationDto) {
    return this.publicGpsService.submitLocation(token, dto);
  }

  // Enlace de encuesta de satisfacción enviado por correo al cerrar una
  // oportunidad — mismo patrón de token de un solo uso que gps-requests.
  @Get('surveys/:token')
  @UseGuards(SpanishThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async checkSurvey(@Param('token') token: string) {
    return this.publicSurveyService.checkToken(token);
  }

  @Post('surveys/:token')
  @UseGuards(SpanishThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  async submitSurvey(@Param('token') token: string, @Body() dto: SubmitSurveyDto) {
    return this.publicSurveyService.submitSurvey(token, dto);
  }
}
