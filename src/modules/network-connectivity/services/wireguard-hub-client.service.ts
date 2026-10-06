import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface HubPeerStatus {
  publicKey: string;
  endpoint: string | null;
  allowedIps: string;
  lastHandshakeAt: string | null;
  transferRxBytes: number;
  transferTxBytes: number;
}

export interface HubOperationResult {
  success: boolean;
  errorMessage?: string;
}

/**
 * Cliente HTTP hacia sumtech-wg-agent (repo aparte, Fase B —
 * Plan_WireGuard_Produccion.md). El backend NUNCA ejecuta `wg` directamente;
 * si el agente no está configurado o no responde, cada método devuelve
 * success:false en vez de lanzar, para que el llamador pueda seguir
 * ofreciendo el flujo manual de la Fase A como respaldo.
 */
@Injectable()
export class WireGuardHubClient {
  private readonly logger = new Logger(WireGuardHubClient.name);

  isConfigured(): boolean {
    return Boolean(process.env.WIREGUARD_AGENT_URL && process.env.WIREGUARD_AGENT_TOKEN);
  }

  async registerPeer(publicKey: string, allowedIps: string): Promise<HubOperationResult> {
    if (!this.isConfigured()) {
      return { success: false, errorMessage: 'sumtech-wg-agent no está configurado (WIREGUARD_AGENT_URL/WIREGUARD_AGENT_TOKEN)' };
    }

    try {
      await this.client().post('/peers', { publicKey, allowedIps });
      return { success: true };
    } catch (err: any) {
      const message = err.response?.data?.error || err.message || 'Error desconocido registrando el peer';
      this.logger.warn(`No se pudo registrar el peer ${publicKey} en el hub: ${message}`);
      return { success: false, errorMessage: message };
    }
  }

  async removePeer(publicKey: string): Promise<HubOperationResult> {
    if (!this.isConfigured()) {
      return { success: false, errorMessage: 'sumtech-wg-agent no está configurado' };
    }

    try {
      await this.client().delete(`/peers/${encodeURIComponent(publicKey)}`);
      return { success: true };
    } catch (err: any) {
      const message = err.response?.data?.error || err.message || 'Error desconocido eliminando el peer';
      this.logger.warn(`No se pudo eliminar el peer ${publicKey} del hub: ${message}`);
      return { success: false, errorMessage: message };
    }
  }

  /** Devuelve el estado de un peer puntual, o null si el agente no responde o el peer no está registrado ahí. */
  async getPeerStatus(publicKey: string): Promise<HubPeerStatus | null> {
    if (!this.isConfigured()) return null;

    try {
      const res = await this.client().get('/peers/status');
      const peers: HubPeerStatus[] = res.data?.peers || [];
      return peers.find((p) => p.publicKey === publicKey) || null;
    } catch (err: any) {
      this.logger.warn(`No se pudo consultar el estado de peers en el hub: ${err.message}`);
      return null;
    }
  }

  private client() {
    return axios.create({
      baseURL: process.env.WIREGUARD_AGENT_URL,
      timeout: 5000,
      headers: { Authorization: `Bearer ${process.env.WIREGUARD_AGENT_TOKEN}` },
    });
  }
}
