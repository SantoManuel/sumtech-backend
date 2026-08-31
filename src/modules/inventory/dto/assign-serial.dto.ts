import { IsNotEmpty, IsUUID, IsString } from 'class-validator';

export class AssignSerialDto {
  @IsNotEmpty()
  @IsString()
  serialNumber: string;

  @IsNotEmpty()
  @IsUUID('4')
  clientId: string;
}
