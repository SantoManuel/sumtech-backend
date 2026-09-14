import { IsOptional, IsUUID, IsIn } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

const AUDIT_ACTIONS = ['CREATE', 'PROVISION', 'SUSPEND', 'RESTORE', 'DEPROVISION', 'SHADOW_CHECK', 'SYNC_PROFILE'] as const;
const AUDIT_RESULTS = ['OK', 'ERROR'] as const;

export class FindAuditLogDto extends PaginationDto {
  @IsOptional()
  @IsUUID('4', { message: 'contractId debe ser un UUID válido' })
  contractId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'nodeId debe ser un UUID válido' })
  nodeId?: string;

  @IsOptional()
  @IsIn(AUDIT_ACTIONS, { message: `action debe ser uno de: ${AUDIT_ACTIONS.join(', ')}` })
  action?: (typeof AUDIT_ACTIONS)[number];

  @IsOptional()
  @IsIn(AUDIT_RESULTS, { message: `result debe ser uno de: ${AUDIT_RESULTS.join(', ')}` })
  result?: (typeof AUDIT_RESULTS)[number];
}
