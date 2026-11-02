import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { OnuOmciWanProfile } from '../ports/onu-wan.types';

export class OnuOmciWanProfileDto implements OnuOmciWanProfile {
  @IsUUID() oltId: string;
  @IsBoolean() enabled: boolean;
  @IsIn(['PILOT', 'VALIDATED']) validation: 'PILOT' | 'VALIDATED';
  @IsString() @Length(1, 50) serialNumber: string;
  @IsString() @Length(1, 50) oltFirmware: string;
  @IsString() @Length(1, 100) onuFirmware: string;
  @IsString() @Matches(/^[A-Za-z0-9_.-]{1,100}$/) vendorTypeName: string;
  @IsString() @Matches(/^[A-Za-z0-9_.-]{1,100}$/) vlanProfile: string;
  @IsInt() @Min(1) @Max(4094) serviceVlan: number;
  @IsInt() @Min(1) @Max(8) wanIndex: number;
  @IsInt() @Min(1) @Max(8) hostId: number;
  @IsIn(['pap', 'chap', 'auto']) auth: 'pap' | 'chap' | 'auto';
  @IsString() @IsNotEmpty() @Length(10, 1000) evidence: string;
}
