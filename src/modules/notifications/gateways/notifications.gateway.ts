import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getJwtSecret } from '../../../common/utils/required-env.util';
import { getConfiguredCorsOrigins, isAllowedCorsOrigin } from '../../../common/utils/cors-origin.util';
import { StaffNotificationEntity } from '../entities/staff-notification.entity';
import { ClientNotificationEntity } from '../../portal/entities/client-notification.entity';

@Injectable()
@WebSocketGateway({
  namespace: '/ws/notifications',
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow: boolean) => void) => {
      callback(null, isAllowedCorsOrigin(origin, getConfiguredCorsOrigins()));
    },
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const authHeader = client.handshake.headers.authorization;
      const rawToken = client.handshake.auth?.token || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

      if (!rawToken) {
        this.logger.warn(`Cliente ${client.id} rechazado: sin token.`);
        client.disconnect();
        return;
      }

      let payload: any;
      try {
        payload = this.jwtService.verify(rawToken, { secret: getJwtSecret(this.configService) });
      } catch (err: any) {
        this.logger.warn(`Cliente ${client.id} rechazado: token inválido (${err.message}).`);
        client.disconnect();
        return;
      }

      const userId = payload.sub || payload.id || payload.userId;
      const tenantId = payload.tenantId || 'default';
      const clientId = payload.clientId;
      const roles: string[] = Array.isArray(payload.roles) ? payload.roles : [];

      client.data = { userId, tenantId, clientId, roles };

      // Suscribir a salas operativas con aislamiento multi-tenant estricto
      if (tenantId) {
        client.join(`tenant:${tenantId}`);
        for (const role of roles) {
          client.join(`tenant:${tenantId}:role:${role}`);
        }
      }

      if (userId) {
        client.join(`user:${userId}`);
        if (tenantId) {
          client.join(`tenant:${tenantId}:user:${userId}`);
        }
      }

      // Sala específica para el abonado/cliente final dentro de su tenant
      if (clientId) {
        client.join(`client:${clientId}`);
        if (tenantId) {
          client.join(`tenant:${tenantId}:client:${clientId}`);
        }
      }

      this.logger.log(`Cliente conectado: User ${userId} (Tenant ${tenantId}, ClientId: ${clientId || 'N/A'}, Roles: ${roles.join(', ')})`);
      client.emit('connected', { status: 'ok', userId, tenantId, clientId });
    } catch (err: any) {
      this.logger.error(`Error en handshake WebSocket: ${err.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    const { userId, tenantId, clientId } = client.data || {};
    this.logger.log(`Cliente desconectado: ${client.id} (User: ${userId || 'N/A'}, Tenant: ${tenantId || 'N/A'}, Client: ${clientId || 'N/A'})`);
  }

  /**
   * Emite una notificación en tiempo real a los destinatarios adecuados.
   */
  emitStaffNotification(tenantId: string, notification: StaffNotificationEntity, unreadCount?: number): void {
    if (!this.server) {
      this.logger.warn('WebSocketServer no inicializado aún al emitir notificación.');
      return;
    }

    try {
      const payload = {
        notification,
        unreadCount,
        timestamp: new Date().toISOString(),
      };

      if (notification.userId) {
        // Alerta dirigida a un usuario específico
        this.server.to(`user:${notification.userId}`).emit('new_notification', payload);
      } else if (notification.targetRole && notification.targetRole !== 'ALL') {
        // Alerta dirigida a un rol específico
        this.server.to(`tenant:${tenantId}:role:${notification.targetRole}`).emit('new_notification', payload);
      } else {
        // Alerta global del tenant
        this.server.to(`tenant:${tenantId}`).emit('new_notification', payload);
      }
    } catch (err: any) {
      this.logger.error(`Error emitiendo notificación por WebSocket: ${err.message}`);
    }
  }

  /**
   * Emite actualización del contador de notificaciones no leídas
   */
  emitUnreadCountUpdated(tenantId: string, userId?: string, unreadCount?: number): void {
    if (!this.server) return;
    try {
      if (userId) {
        this.server.to(`user:${userId}`).emit('unread_count_updated', { unreadCount });
      } else {
        this.server.to(`tenant:${tenantId}`).emit('unread_count_updated', { unreadCount });
      }
    } catch (err: any) {
      this.logger.error(`Error emitiendo contador por WebSocket: ${err.message}`);
    }
  }

  /**
   * Emite una notificación en tiempo real a un cliente/abonado específico en su tenant.
   */
  emitClientNotification(tenantId: string, clientId: string, notification: ClientNotificationEntity): void {
    if (!this.server) {
      this.logger.warn('WebSocketServer no inicializado aún al emitir notificación de cliente.');
      return;
    }

    try {
      const payload = {
        notification,
        timestamp: new Date().toISOString(),
      };

      // Emite con aislamiento multi-tenant estricto
      this.server.to(`tenant:${tenantId}:client:${clientId}`).emit('portal:notification:new', payload);
      // Y también por fallback a la sala de cliente
      this.server.to(`client:${clientId}`).emit('portal:notification:new', payload);
      this.logger.log(`Notificación emitida al cliente ${clientId} (Tenant: ${tenantId}): ${notification.title}`);
    } catch (err: any) {
      this.logger.error(`Error emitiendo notificación a cliente por WebSocket: ${err.message}`);
    }
  }

  /**
   * Emite evento de actualización de lectura para el cliente en tiempo real.
   */
  emitClientNotificationRead(tenantId: string, clientId: string, notificationId: string): void {
    if (!this.server) return;
    try {
      const payload = { id: notificationId, timestamp: new Date().toISOString() };
      this.server.to(`tenant:${tenantId}:client:${clientId}`).emit('portal:notification:read', payload);
      this.server.to(`client:${clientId}`).emit('portal:notification:read', payload);
    } catch (err: any) {
      this.logger.error(`Error emitiendo notificación leída a cliente por WebSocket: ${err.message}`);
    }
  }

  /**
   * Emite evento de marcado masivo como leído para el cliente.
   */
  emitClientAllNotificationsRead(tenantId: string, clientId: string): void {
    if (!this.server) return;
    try {
      this.server.to(`tenant:${tenantId}:client:${clientId}`).emit('portal:notification:read_all', {});
      this.server.to(`client:${clientId}`).emit('portal:notification:read_all', {});
    } catch (err: any) {
      this.logger.error(`Error emitiendo lectura masiva a cliente por WebSocket: ${err.message}`);
    }
  }
}
