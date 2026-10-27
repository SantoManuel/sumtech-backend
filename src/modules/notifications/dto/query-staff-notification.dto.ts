import { IsOptional, IsEnum, IsBoolean, IsInt, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import type { NotificationCategory } from '../entities/staff-notification.entity';

export class QueryStaffNotificationDto {
  @IsOptional()
  @IsEnum(['ALL', 'INVENTORY', 'OPERATIONS', 'NETWORK', 'BILLING', 'SYSTEM'])
  category?: 'ALL' | NotificationCategory;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  isRead?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
