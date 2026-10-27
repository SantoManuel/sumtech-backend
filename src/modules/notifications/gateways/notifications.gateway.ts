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
      const roles: string[] = Array.isArray(payload.roles) ? payload.roles : [];

      client.data = { userId, tenantId, roles };

      // Suscribir a salas operativas
      if (tenantId) {
        client.join(`tenant:${tenantId}`);
        for (const role of roles) {
          client.join(`tenant:${tenantId}:role:${role}`);
        }
      }

      if (userId) {
        client.join(`user:${userId}`);
      }

      this.logger.log(`Cliente conectado: User ${userId} (Tenant ${tenantId}, Roles: ${roles.join(', ')})`);
      client.emit('connected', { status: 'ok', userId, tenantId });
    } catch (err: any) {
      this.logger.error(`Error en handshake WebSocket: ${err.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    const { userId, tenantId } = client.data || {};
    this.logger.log(`Cliente desconectado: ${client.id} (User: ${userId || 'N/A'}, Tenant: ${tenantId || 'N/A'})`);
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
}
