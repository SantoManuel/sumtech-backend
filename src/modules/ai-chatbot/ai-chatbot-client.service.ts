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
 * Gemini/Ollama, ahora SaaS multi-tenant). Encapsula la comunicación
 * server-to-server para que sus consumidores (PortalService para clientes
 * autenticados, PublicChatService para visitantes anónimos del landing) no
 * conozcan detalles de transporte/autenticación — solo piden "responde este
 * mensaje" y reciben la respuesta ya tipada.
 *
 * Sumtech es "un tenant más" del SaaS (slug `sumtech`, plan PRO) — por eso el
 * mensaje conversacional viaja por el endpoint multi-tenant genérico
 * `POST /chat/widget/message` con la TenantApiKey SECRET del tenant, en vez
 * del endpoint legacy `/chat/web/message` (que no resuelve tenant y usaba la
 * key maestra de administración). Las otras dos llamadas (`/whatsapp/send` y
 * `/admin/conversations/...`) siguen usando esa key maestra a propósito: son
 * endpoints administrativos que `TenantApiKeyGuard` no protege.
 */
@Injectable()
export class AiChatbotClientService {
  private readonly logger = new Logger(AiChatbotClientService.name);
  private readonly http: AxiosInstance;
  private readonly tenantApiKey: string;
  private readonly tenantId: string;

  constructor() {
    this.tenantApiKey = process.env.CHATBOT_TENANT_API_KEY || '';
    this.tenantId = process.env.CHATBOT_TENANT_ID || '';

    this.http = axios.create({
      baseURL: process.env.CHATBOT_URL || 'http://localhost:4001/api/v1',
      // Medido en vivo: con el proveedor local (Ollama, sin GPU dedicada) la
      // latencia real de Chatbot_sumtech (RAG + LLM) llegó a 31s en una sola
      // consulta y el propio timeout interno de Chatbot_sumtech hacia Ollama
      // es de 120s (ver AiProviderProfile.config.timeoutMs) — un timeout aquí
      // por debajo de eso cortaría respuestas que sí iban a completarse.
      // Configurable por env porque Sumtech piensa seguir en modelo local
      // (más lento que un proveedor en la nube) y este valor puede necesitar
      // ajuste sin redeploy si la latencia real cambia.
      timeout: Number(process.env.CHATBOT_TIMEOUT_MS) || 150000,
      headers: {
        // Key maestra de administración — solo para /whatsapp/send y
        // /admin/*. sendMessage() pisa este header con la TenantApiKey en
        // cada request porque /chat/widget/* no acepta la key maestra.
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
    const { data } = await this.http.post<AiChatbotResponse>(
      '/chat/widget/message',
      { sessionId, message, userName },
      { headers: { 'x-api-key': this.tenantApiKey } },
    );
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
   * Trae el hilo completo de la conversación más reciente asociada a un
   * `externalId` de Chatbot_sumtech — usado por el CRM del ERP para tabular
   * la charla del lead con el bot/agente. Qué es el `externalId` depende del
   * canal por el que llegó el lead: para WhatsApp es el teléfono (solo
   * dígitos, sin "+" ni sufijos); para el widget de chat de la landing page
   * (`source: WEB_CHATBOT`) es el `id` de la Opportunity, porque así lo envía
   * `PublicChatService.sendMessage` como `sessionId`. Devuelve `null` si no
   * hay conversación registrada (404), en vez de lanzar — es un caso
   * esperado, no un error.
   *
   * `WidgetChatController` (multi-tenant) guarda el externalId con prefijo
   * `${tenantId}_${sessionId}` — se intenta primero así, y si no aparece se
   * reintenta sin prefijo por compatibilidad con conversaciones creadas antes
   * de migrar a `/chat/widget/message` (donde el externalId viajaba crudo).
   */
  async getConversationByExternalId(externalId: string): Promise<AiChatbotConversation | null> {
    const prefixedId = this.tenantId ? `${this.tenantId}_${externalId}` : externalId;
    const prefixedResult = await this.fetchConversationByExternalId(prefixedId);
    if (prefixedResult !== null) {
      return prefixedResult;
    }
    if (prefixedId === externalId) {
      return null;
    }
    return this.fetchConversationByExternalId(externalId);
  }

  private async fetchConversationByExternalId(externalId: string): Promise<AiChatbotConversation | null> {
    try {
      const { data } = await this.http.get<AiChatbotConversation>(`/admin/conversations/by-external-id/${externalId}`);
      return data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
      this.logger.warn(`No se pudo obtener la conversación de ${externalId}: ${(err as Error).message}`);
      return null;
    }
  }
}
