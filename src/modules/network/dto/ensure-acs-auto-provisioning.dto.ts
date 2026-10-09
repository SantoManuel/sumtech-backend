import { IsString, IsNotEmpty, IsUrl } from 'class-validator';

export class EnsureAcsAutoProvisioningDto {
  /** URL del servidor ACS (GenieACS CWMP) que los CPEs deben usar, ej. "http://66.94.107.219:7547". */
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  acsUrl: string;
}
