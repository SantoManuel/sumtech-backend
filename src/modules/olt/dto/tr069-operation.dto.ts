import { IsOptional, IsString, IsUUID, MaxLength, Matches } from 'class-validator';

export class Tr069OperationDto {
  @IsUUID() tr069NetworkId: string;
  @IsOptional() @IsString() @MaxLength(128) @Matches(/^[A-Za-z0-9_@.+,=!?%$*:/-]+$/) tr069AcsUsername?: string;
  @IsOptional() @IsString() @MaxLength(128) @Matches(/^[A-Za-z0-9_@.+,=!?%$*:/-]+$/) tr069AcsPassword?: string;
}
