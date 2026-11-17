import { IsIn } from 'class-validator';
import { OnuOperationMode } from '../ports/onu-mode.types';

export class ChangeOnuModeDto {
  @IsIn(['ROUTER', 'BRIDGE'])
  operationMode: OnuOperationMode;
}
