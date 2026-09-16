import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export interface AiChatbotResponse {
  conversationId: string;
  response: string;
  intent?: string;
  status: string;
  escalated: boolean;
}

export interface AiChatbotMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'agent';
  content: string;
  createdAt: string;
}

export interface AiChatbotConversation {
  id: string;
  channel: string;
  externalId: string;
  status: string;
  messages: AiChatbotMessage[];
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

  /**
   * Envía un WhatsApp saliente arbitrario (ej. el enlace de "comparte tu
   * ubicación GPS" al crear un cliente) reutilizando la instancia de Evolution
   * API que ya administra `Chatbot_sumtech`. Nunca lanza: si la sesión de
   * WhatsApp no está conectada o el envío falla, el llamador debe caer al
   * flujo manual de "copiar enlace" en vez de bloquear la operación.
   */
  async sendWhatsAppMessage(phone: string, text: string): Promise<boolean> {
    try {
      const { data } = await this.http.post<{ success: boolean }>('/whatsapp/send', { phone, text });
      return !!data?.success;
    } catch (err) {
      this.logger.warn(`No se pudo enviar el WhatsApp a ${phone}: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Trae el hilo completo de la conversación más reciente de un teléfono —
   * usado por el CRM del ERP para tabular la charla del lead con el
   * bot/agente. `externalId` en Chatbot_sumtech se guarda solo con dígitos
   * (sin "+" ni sufijos de WhatsApp); el llamador debe normalizar el teléfono
   * antes de invocar este método. Devuelve `null` si no hay conversación
   * registrada (404), en vez de lanzar — es un caso esperado, no un error.
   */
  async getConversationByPhone(phone: string): Promise<AiChatbotConversation | null> {
    try {
      const { data } = await this.http.get<AiChatbotConversation>(`/admin/conversations/by-external-id/${phone}`);
      return data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
      this.logger.warn(`No se pudo obtener la conversación de ${phone}: ${(err as Error).message}`);
      return null;
    }
  }
}
