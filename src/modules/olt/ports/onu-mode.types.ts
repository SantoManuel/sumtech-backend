export type OnuOperationMode = 'ROUTER' | 'BRIDGE';

export interface OnuModeDetectionResult {
  mode: 'bridge' | 'router' | 'mixed' | 'unknown';
  internetVlan?: number;
  managementVlan?: number;
  internetIpHost?: number;
  managementIpHost?: number;
  dhcpSource?: 'from-onu' | 'from-internet' | 'none' | 'mixed';
  ethPortsDetected: number[];
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
}

export interface OnuModeSwitchParams {
  ponInterface: string;
  onuId: number;
  serviceVlan: number;
  ethPorts: number;
  ethuniDhcpDelegationSupported?: boolean;
  operationMode: OnuOperationMode;
}

export interface OnuModeSwitchResult {
  ok: boolean;
  changed: boolean;
  observed?: OnuModeDetectionResult;
  error?: string;
}
