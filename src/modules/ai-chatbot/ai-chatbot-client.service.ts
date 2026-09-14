import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export interface AiChatbotResponse {
  conversationId: string;
  response: string;
  intent?: string;
  status: string;
  escalated: boolean;
}

/**
 * Cliente HTTP hacia `Chatbot_sumtech` (proyecto NestJS separado con RAG +
 * Gemini/Ollama). Encapsula la comunicación server-to-server para que sus
 * consumidores (PortalService para clientes autenticados, PublicChatService
 * para visitantes anónimos del landing) no conozcan detalles de transporte/
 * autenticación — solo piden "responde este mensaje" y reciben la respuesta
 * ya tipada.
 *
 * `Chatbot_sumtech` expone `POST /chat/web/message` como único endpoint
 * genérico de texto (el resto de sus controllers están acoplados a webhooks
 * de WhatsApp/Meta/Twilio). Protegido con ApiKeyGuard del lado del chatbot.
 */
@Injectable()
export class AiChatbotClientService {
  private readonly logger = new Logger(AiChatbotClientService.name);
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: process.env.CHATBOT_URL || 'http://localhost:4001/api/v1',
      // Medido en vivo: la latencia real de Chatbot_sumtech (RAG + Gemini)
      // varía entre ~3s y ~42s según la consulta — un timeout corto (8s)
      // provocaba fallbacks espurios al ERP aunque la IA sí iba a responder.
      timeout: 45000,
      headers: {
        'x-api-key': process.env.CHATBOT_API_KEY || '',
      },
    });
  }

  /**
   * `sessionId` identifica la conversación en Chatbot_sumtech (su `externalId`
   * es un string libre, no requiere que exista un cliente/usuario del ERP).
   * El portal usa el `clientId` del cliente autenticado; el chat público del
   * landing usa el `id` del Lead creado para el visitante anónimo.
   */
  async sendMessage(sessionId: string, message: string, userName?: string): Promise<AiChatbotResponse> {
    const { data } = await this.http.post<AiChatbotResponse>('/chat/web/message', {
      sessionId,
      message,
      userName,
    });
    return data;
  }
}
