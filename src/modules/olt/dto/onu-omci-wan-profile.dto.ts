import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { OnuOmciWanProfile } from '../ports/onu-wan.types';

export class OnuOmciWanProfileDto implements OnuOmciWanProfile {
  @IsOptional() @IsIn(['WAN_IP', 'WAN_SERVICE']) commandStyle?: 'WAN_IP' | 'WAN_SERVICE';
  @IsUUID() oltId: string;
  @IsBoolean() enabled: boolean;
  @IsIn(['PILOT', 'VALIDATED']) validation: 'PILOT' | 'VALIDATED';
  @IsString() @Length(1, 50) serialNumber: string;
  @IsString() @Length(1, 50) oltFirmware: string;
  @IsString() @Length(1, 100) onuFirmware: string;
  @IsString() @Matches(/^[A-Za-z0-9_.-]{1,100}$/) vendorTypeName: string;
  @ValidateIf(o => o.commandStyle !== 'WAN_SERVICE' || o.vlanProfile !== undefined)
  @IsString() @Matches(/^[A-Za-z0-9_.-]{1,100}$/) vlanProfile?: string;
  @ValidateIf(o => o.commandStyle === 'WAN_SERVICE' || o.ethUniPorts !== undefined)
  @IsString() @Matches(/^[1-4](?:-[1-4])?$/) ethUniPorts?: string;
  @ValidateIf(o => o.commandStyle === 'WAN_SERVICE' || o.ssidPorts !== undefined)
  @IsString() @Matches(/^[1-4](?:-[1-4])?$/) ssidPorts?: string;
  @IsInt() @Min(1) @Max(4094) serviceVlan: number;
  @IsInt() @Min(1) @Max(8) wanIndex: number;
  @IsInt() @Min(1) @Max(8) hostId: number;
  @ValidateIf(o => o.commandStyle !== 'WAN_SERVICE' || o.auth !== undefined)
  @IsIn(['pap', 'chap', 'auto']) auth?: 'pap' | 'chap' | 'auto';
  @IsString() @IsNotEmpty() @Length(10, 1000) evidence: string;
}
