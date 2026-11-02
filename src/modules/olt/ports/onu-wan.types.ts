export type WanProvisioningMethod = 'OMCI' | 'TR069';
export type WanApplyStatus = 'NOT_CONFIGURED' | 'PENDING' | 'APPLYING' | 'QUEUED' | 'VERIFYING' | 'APPLIED' | 'ERROR' | 'UNKNOWN';

/** Per-ONU pilot recipe, explicitly registered by an administrator. Never inherited on replacement. */
export interface OnuOmciWanProfile {
  oltId: string;
  enabled: boolean;
  validation: 'PILOT' | 'VALIDATED';
  serialNumber: string;
  oltFirmware: string;
  onuFirmware: string;
  vendorTypeName: string;
  vlanProfile: string;
  serviceVlan: number;
  wanIndex: number;
  hostId: number;
  auth: 'pap' | 'chap' | 'auto';
  evidence: string;
}

export interface ConfigureOnuWanParams {
  onuInterface: string;
  serialNumber: string;
  profile: OnuOmciWanProfile;
  username: string;
  password: string;
}

export interface OnuWanConfiguration {
  wanIndex: number;
  serialNumber?: string;
  vendorTypeName?: string;
  configState?: string;
  mode?: string;
  username?: string;
  vlanProfile?: string;
  hostId?: number;
  /** Redacted evidence only; never return a password, even from running-config. */
  evidence: string;
}

export interface OnuWanApplyResult {
  status: 'APPLIED' | 'VERIFYING' | 'UNKNOWN';
  configuration?: OnuWanConfiguration;
  warning?: string;
}
