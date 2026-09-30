import { IsOptional, IsInt, IsEnum, IsNumber, Min } from 'class-validator';

export class UpdateBillingSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  graceDaysBeforeSuspension?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reminderDaysAfterDue?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  advanceReminderDaysBeforeDue?: number;

  @IsOptional()
  @IsEnum(['FIXED_30', 'ACTUAL_MONTH_DAYS', 'CYCLE_DAYS'])
  prorationDayCountPolicy?: 'FIXED_30' | 'ACTUAL_MONTH_DAYS' | 'CYCLE_DAYS';

  @IsOptional()
  @IsNumber()
  @Min(0)
  reconnectionFeeAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cashierDiscountCapAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  cashierVoidWindowHours?: number;
}
