import { IsOptional, IsInt, Min } from 'class-validator';

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
}
