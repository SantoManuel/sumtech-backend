import { Module } from '@nestjs/common';
import { AiChatbotClientService } from './ai-chatbot-client.service';

/**
 * Módulo compartido y sin estado propio de base de datos — solo expone
 * `AiChatbotClientService`. Lo importan tanto `PortalModule` (chat del
 * portal de clientes autenticados) como `PublicModule` (chat público del
 * landing), evitando que uno dependa directamente del otro para algo que
 * ninguno de los dos "posee" conceptualmente.
 */
@Module({
  providers: [AiChatbotClientService],
  exports: [AiChatbotClientService],
})
export class AiChatbotClientModule {}
