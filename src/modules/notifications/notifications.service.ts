import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaffNotificationEntity } from './entities/staff-notification.entity';
import { CreateStaffNotificationDto } from './dto/create-staff-notification.dto';
import { QueryStaffNotificationDto } from './dto/query-staff-notification.dto';
import { NotificationsGateway } from './gateways/notifications.gateway';

@Injectable()
export class StaffNotificationService {
  private readonly logger = new Logger(StaffNotificationService.name);

  constructor(
    @InjectRepository(StaffNotificationEntity)
    private readonly notificationRepo: Repository<StaffNotificationEntity>,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  /**
   * Crea una notificación persistente y la emite de inmediato por WebSockets.
   */
  async createAndEmit(
    dto: CreateStaffNotificationDto,
    tenantId: string = 'default',
  ): Promise<StaffNotificationEntity> {
    const notification = this.notificationRepo.create({
      userId: dto.userId || null,
      targetRole: dto.targetRole || 'ALL',
      category: dto.category,
      severity: dto.severity,
      title: dto.title,
      message: dto.message,
      link: dto.link || null,
      metadata: dto.metadata || null,
      isRead: false,
    });

    const saved = await this.notificationRepo.save(notification);

    try {
      // Calcular contador no leído para el destinatario
      const unreadCount = await this.getUnreadCount(dto.userId || undefined, dto.targetRole ? [dto.targetRole] : ['ADMIN']);
      this.notificationsGateway.emitStaffNotification(tenantId, saved, unreadCount);
    } catch (err: any) {
      this.logger.error(`Error emitiendo WebSocket tras guardar notificación: ${err.message}`);
    }

    return saved;
  }

  /**
   * Lista las notificaciones accesibles para el usuario según su ID y roles.
   */
  async findAll(
    userId: string,
    roles: string[] = ['ADMIN'],
    query: QueryStaffNotificationDto,
  ): Promise<{ data: StaffNotificationEntity[]; total: number; unreadCount: number }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    const qb = this.notificationRepo.createQueryBuilder('n');

    // Condición de visibilidad: dirigida al usuario O a uno de sus roles O para ALL
    qb.where(
      '(n.userId = :userId OR (n.userId IS NULL AND (n.targetRole IN (:...roles) OR n.targetRole = :allRole)))',
      {
        userId,
        roles: roles.length > 0 ? roles : ['ADMIN'],
        allRole: 'ALL',
      },
    );

    if (query.category && query.category !== 'ALL') {
      qb.andWhere('n.category = :category', { category: query.category });
    }

    if (query.isRead !== undefined) {
      qb.andWhere('n.isRead = :isRead', { isRead: query.isRead });
    }

    qb.orderBy('n.createdAt', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();
    const unreadCount = await this.getUnreadCount(userId, roles);

    return { data, total, unreadCount };
  }

  /**
   * Obtiene el número total de notificaciones no leídas para el usuario.
   */
  async getUnreadCount(userId?: string, roles: string[] = ['ADMIN']): Promise<number> {
    const qb = this.notificationRepo.createQueryBuilder('n');
    qb.where('n.isRead = :isRead', { isRead: false });

    if (userId) {
      qb.andWhere(
        '(n.userId = :userId OR (n.userId IS NULL AND (n.targetRole IN (:...roles) OR n.targetRole = :allRole)))',
        {
          userId,
          roles: roles.length > 0 ? roles : ['ADMIN'],
          allRole: 'ALL',
        },
      );
    } else {
      qb.andWhere('(n.targetRole IN (:...roles) OR n.targetRole = :allRole)', {
        roles: roles.length > 0 ? roles : ['ADMIN'],
        allRole: 'ALL',
      });
    }

    return qb.getCount();
  }

  /**
   * Marca una notificación como leída.
   */
  async markAsRead(
    userId: string,
    roles: string[] = ['ADMIN'],
    notificationId: string,
  ): Promise<StaffNotificationEntity> {
    const qb = this.notificationRepo.createQueryBuilder('n');
    qb.where('n.id = :id', { id: notificationId });
    qb.andWhere(
      '(n.userId = :userId OR (n.userId IS NULL AND (n.targetRole IN (:...roles) OR n.targetRole = :allRole)))',
      {
        userId,
        roles: roles.length > 0 ? roles : ['ADMIN'],
        allRole: 'ALL',
      },
    );

    const notification = await qb.getOne();
    if (!notification) {
      throw new NotFoundException(`Notificación ${notificationId} no encontrada o no autorizada.`);
    }

    if (!notification.isRead) {
      notification.isRead = true;
      notification.readAt = new Date();
      await this.notificationRepo.save(notification);
    }

    return notification;
  }

  /**
   * Marca todas las notificaciones pendientes como leídas.
   */
  async markAllAsRead(
    userId: string,
    roles: string[] = ['ADMIN'],
    tenantId: string = 'default',
  ): Promise<{ affected: number }> {
    const qb = this.notificationRepo.createQueryBuilder('n');
    qb.where('n.isRead = :isRead', { isRead: false });
    qb.andWhere(
      '(n.userId = :userId OR (n.userId IS NULL AND (n.targetRole IN (:...roles) OR n.targetRole = :allRole)))',
      {
        userId,
        roles: roles.length > 0 ? roles : ['ADMIN'],
        allRole: 'ALL',
      },
    );

    const pending = await qb.getMany();
    if (pending.length === 0) {
      return { affected: 0 };
    }

    const now = new Date();
    for (const item of pending) {
      item.isRead = true;
      item.readAt = now;
    }

    await this.notificationRepo.save(pending);

    // Notificar actualización de contador a 0
    this.notificationsGateway.emitUnreadCountUpdated(tenantId, userId, 0);

    return { affected: pending.length };
  }

  /**
   * Elimina una notificación específica.
   */
  async delete(
    userId: string,
    roles: string[] = ['ADMIN'],
    notificationId: string,
  ): Promise<{ success: boolean }> {
    const qb = this.notificationRepo.createQueryBuilder('n');
    qb.where('n.id = :id', { id: notificationId });
    qb.andWhere(
      '(n.userId = :userId OR (n.userId IS NULL AND (n.targetRole IN (:...roles) OR n.targetRole = :allRole)))',
      {
        userId,
        roles: roles.length > 0 ? roles : ['ADMIN'],
        allRole: 'ALL',
      },
    );

    const notification = await qb.getOne();
    if (!notification) {
      throw new NotFoundException(`Notificación ${notificationId} no encontrada o no autorizada.`);
    }

    await this.notificationRepo.remove(notification);
    return { success: true };
  }
}
