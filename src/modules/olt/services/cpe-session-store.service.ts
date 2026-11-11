import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

export interface CpeProxySession {
  onuId: string;
  serialNumber: string;
  targetIp: string;
  port: number;
  userId: string;
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas, igual que el token JWT que lo origina.

/**
 * Reemplaza la cookie global `sumtech_cpe_token` (ver git history de
 * CpeProxyMiddleware) como mecanismo para recordar a qué ONU pertenece cada
 * sesión de "Interfaz Web de la ONU". Una cookie por navegador significaba
 * que abrir una segunda ONU en otra pestaña pisaba silenciosamente la sesión
 * de la primera -- confirmado en vivo (2026-11-10, HWTCD53E8C8A mostrando el
 * contenido de CMDCDD4D131E). Cada sesión ahora vive en su propio `sessionId`
 * dentro de la URL (`/cpe/<sessionId>/...`), así que múltiples pestañas con
 * ONUs distintas nunca comparten estado.
 *
 * En memoria a propósito: cada tenant corre en un solo proceso backend (ver
 * [[sumtech_coolify_vps_deployment]]) -- si alguna vez se escala a múltiples
 * instancias del mismo tenant en paralelo, esto necesitaría moverse a Redis
 * (ya hay `ioredis` como dependencia para eso).
 */
@Injectable()
export class CpeSessionStoreService {
  private readonly sessions = new Map<string, CpeProxySession & { expiresAt: number }>();

  create(session: CpeProxySession): string {
    this.evictExpired();
    const sessionId = crypto.randomBytes(16).toString('hex');
    this.sessions.set(sessionId, { ...session, expiresAt: Date.now() + SESSION_TTL_MS });
    return sessionId;
  }

  get(sessionId: string): CpeProxySession | null {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }
    const { expiresAt: _expiresAt, ...session } = entry;
    return session;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [id, entry] of this.sessions.entries()) {
      if (now > entry.expiresAt) this.sessions.delete(id);
    }
  }
}
