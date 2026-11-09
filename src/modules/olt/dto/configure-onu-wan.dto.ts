import { IsIn, IsInt, IsIP, IsOptional, IsString, Min, Max, ValidateIf } from 'class-validator';

export class ConfigureOnuWanDto {
  @IsOptional() @IsIn(['OMCI', 'TR069']) provisioningMethod?: 'OMCI' | 'TR069';
  @IsOptional() @IsIn(['PPPOE', 'DHCP', 'STATIC']) wanMode?: 'PPPOE' | 'DHCP' | 'STATIC';
  @IsOptional() @IsIn(['IPV4', 'IPV6', 'DUAL']) ipProtocol?: 'IPV4' | 'IPV6' | 'DUAL';
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
  @IsOptional() @IsString() pppoeUsername?: string;
  @IsOptional() @IsString() pppoePassword?: string;
  @ValidateIf(o => o.wanMode === 'STATIC') @IsIP('4') wanStaticIp?: string;
  @ValidateIf(o => o.wanMode === 'STATIC') @IsIP('4') wanStaticMask?: string;
  @ValidateIf(o => o.wanMode === 'STATIC') @IsIP('4') wanStaticGw?: string;
  @IsOptional() @IsIP('4') wanDns1?: string;
  @IsOptional() @IsIP('4') wanDns2?: string;
  @ValidateIf(o => o.wanMode === 'STATIC' && o.ipProtocol === 'DUAL') @IsIP('6') wanStaticIpv6?: string;
  @ValidateIf(o => o.wanMode === 'STATIC' && o.ipProtocol === 'DUAL') @IsInt() @Min(1) @Max(128) wanStaticIpv6PrefixLen?: number;
  @ValidateIf(o => o.wanMode === 'STATIC' && o.ipProtocol === 'DUAL') @IsIP('6') wanStaticIpv6Gw?: string;
  @IsOptional() @IsIP('6') wanStaticIpv6Dns1?: string;
  @IsOptional() @IsIP('6') wanStaticIpv6Dns2?: string;
}
