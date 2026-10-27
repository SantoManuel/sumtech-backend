import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StaffNotificationService } from '../notifications.service';
import { StaffNotificationEntity } from '../entities/staff-notification.entity';
import { NotificationsGateway } from '../gateways/notifications.gateway';
import { NotFoundException } from '@nestjs/common';

describe('StaffNotificationService', () => {
  let service: StaffNotificationService;
  let repoMock: any;
  let gatewayMock: any;

  const mockNotification: StaffNotificationEntity = {
    id: 'notif-1',
    userId: null,
    targetRole: 'ADMIN',
    category: 'INVENTORY',
    severity: 'WARNING',
    title: 'Stock Bajo',
    message: 'Producto bajo stock mínimo',
    link: '/dashboard/inventario',
    isRead: false,
    readAt: null,
    metadata: { productId: 'prod-1' },
    createdAt: new Date(),
  };

  beforeEach(async () => {
    repoMock = {
      create: jest.fn().mockImplementation((dto) => ({ ...dto })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ ...entity, id: 'notif-saved' })),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockNotification], 1]),
        getCount: jest.fn().mockResolvedValue(1),
        getOne: jest.fn().mockResolvedValue({ ...mockNotification }),
        getMany: jest.fn().mockResolvedValue([{ ...mockNotification }]),
      }),
      remove: jest.fn().mockResolvedValue(true),
    };

    gatewayMock = {
      emitStaffNotification: jest.fn(),
      emitUnreadCountUpdated: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffNotificationService,
        {
          provide: getRepositoryToken(StaffNotificationEntity),
          useValue: repoMock,
        },
        {
          provide: NotificationsGateway,
          useValue: gatewayMock,
        },
      ],
    }).compile();

    service = module.get<StaffNotificationService>(StaffNotificationService);
  });

  it('creates notification and emits via NotificationsGateway', async () => {
    const result = await service.createAndEmit({
      category: 'INVENTORY',
      severity: 'WARNING',
      title: 'Stock Bajo',
      message: 'Falta cable de fibra',
      targetRole: 'ADMIN',
    });

    expect(repoMock.create).toHaveBeenCalled();
    expect(repoMock.save).toHaveBeenCalled();
    expect(gatewayMock.emitStaffNotification).toHaveBeenCalled();
    expect(result.id).toBe('notif-saved');
  });

  it('finds notifications with filters and returns unread count', async () => {
    const result = await service.findAll('user-1', ['ADMIN'], { category: 'INVENTORY', page: 1, limit: 10 });

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.unreadCount).toBe(1);
  });

  it('marks a notification as read and saves read timestamp', async () => {
    const result = await service.markAsRead('user-1', ['ADMIN'], 'notif-1');

    expect(result.isRead).toBe(true);
    expect(result.readAt).toBeDefined();
    expect(repoMock.save).toHaveBeenCalled();
  });

  it('throws NotFoundException when notification to mark as read does not exist', async () => {
    repoMock.createQueryBuilder().getOne.mockResolvedValueOnce(null);

    await expect(service.markAsRead('user-1', ['ADMIN'], 'notif-inexistente')).rejects.toThrow(NotFoundException);
  });

  it('marks all notifications as read and notifies via gateway', async () => {
    const result = await service.markAllAsRead('user-1', ['ADMIN'], 'tenant-1');

    expect(result.affected).toBe(1);
    expect(gatewayMock.emitUnreadCountUpdated).toHaveBeenCalledWith('tenant-1', 'user-1', 0);
  });

  it('deletes a notification', async () => {
    const result = await service.delete('user-1', ['ADMIN'], 'notif-1');

    expect(result.success).toBe(true);
    expect(repoMock.remove).toHaveBeenCalled();
  });
});
