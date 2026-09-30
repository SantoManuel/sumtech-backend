import { NetErrorCode } from '../enums/net-error-code.enum';

export interface TransportConnectionTarget {
  host: string;
  port: number;
  username: string;
  password: string;
  useHttps?: boolean;
  timeoutMs?: number;
}

export interface ConnectionHandshakeResult {
  success: boolean;
  latencyMs: number;
  version?: string;
  architecture?: string;
  boardName?: string;
  errorCode?: NetErrorCode;
  errorMessage?: string;
}

export interface SystemResourceMetrics {
  version: string;
  uptimeSeconds: number;
  cpuLoad: number;
  freeMemoryBytes: number;
  totalMemoryBytes: number;
  freeHddBytes: number;
  totalHddBytes: number;
  boardName: string;
  architectureName: string;
  temperature?: number;
  voltage?: number;
}

export interface IRouterOsTransport {
  readonly transportType: 'REST' | 'ROUTEROS_API' | 'SSH';

  /**
   * Realiza un handshake/verificación de conectividad y autenticación contra el router.
   */
  testConnection(target: TransportConnectionTarget): Promise<ConnectionHandshakeResult>;

  /**
   * Obtiene métricas del sistema (/system/resource y /system/health).
   */
  getSystemResource(target: TransportConnectionTarget): Promise<SystemResourceMetrics>;

  /**
   * Ejecuta una consulta o comando sobre RouterOS.
   */
  query(target: TransportConnectionTarget, path: string, params?: Record<string, any>): Promise<any>;
}
