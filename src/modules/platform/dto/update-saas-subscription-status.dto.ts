import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SaasSubscriptionStatus } from '../enums/saas-subscription-status.enum';

export class UpdateSaasSubscriptionStatusDto {
  @IsEnum(SaasSubscriptionStatus, {
    message: 'El estado debe ser uno de: TRIALING, ACTIVE, PAST_DUE, CANCELED',
  })
  @IsNotEmpty({ message: 'El estado de la suscripción es obligatorio' })
  status: SaasSubscriptionStatus;

  @IsOptional()
  @IsString({ message: 'El motivo debe ser una cadena de texto' })
  reason?: string;
}
