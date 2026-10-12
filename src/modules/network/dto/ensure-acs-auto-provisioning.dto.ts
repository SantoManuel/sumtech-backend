import { IsString, IsNotEmpty, IsUrl } from 'class-validator';

export class EnsureAcsAutoProvisioningDto {
  /** URL del servidor ACS (GenieACS CWMP) que los CPEs deben usar, ej. "http://acs.sumtech.com.do:7547". */
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  acsUrl: string;
}
