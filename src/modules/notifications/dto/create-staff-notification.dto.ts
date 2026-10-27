import { IsNotEmpty, IsString, IsOptional, IsEnum, IsUUID } from 'class-validator';
import type {
  NotificationCategory,
  NotificationSeverity,
  NotificationTargetRole,
} from '../entities/staff-notification.entity';

export class CreateStaffNotificationDto {
  @IsOptional()
  @IsUUID('4')
  userId?: string | null;

  @IsOptional()
  @IsEnum(['ADMIN', 'TECNICO', 'CAJERO', 'GERENTE', 'ALL'])
  targetRole?: NotificationTargetRole;

  @IsNotEmpty()
  @IsEnum(['INVENTORY', 'OPERATIONS', 'NETWORK', 'BILLING', 'SYSTEM'])
  category: NotificationCategory;

  @IsNotEmpty()
  @IsEnum(['INFO', 'WARNING', 'CRITICAL', 'SUCCESS'])
  severity: NotificationSeverity;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  link?: string | null;

  @IsOptional()
  metadata?: Record<string, any> | null;
}
