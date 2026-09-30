import { Injectable, Logger } from '@nestjs/common';
import {
  IRouterOsTransport,
  TransportConnectionTarget,
  ConnectionHandshakeResult,
  SystemResourceMetrics,
} from '../interfaces/routeros-transport.interface';
import { classifyDeviceError } from '../utils/device-error-classifier.util';

// node-routeros exporta RouterOSAPI
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RouterOSAPI } = require('node-routeros');

@Injectable()
export class RouterOsBinaryTransport implements IRouterOsTransport {
  readonly transportType = 'ROUTEROS_API' as const;
  private readonly logger = new Logger(RouterOsBinaryTransport.name);

  async testConnection(target: TransportConnectionTarget): Promise<ConnectionHandshakeResult> {
    const start = Date.now();
    let conn: any = null;

    try {
      const port = target.port === 443 || target.port === 80 ? 8728 : target.port;
      conn = new RouterOSAPI({
        host: target.host,
        user: target.username,
        password: target.password,
        port,
        timeout: target.timeoutMs ? Math.max(1, Math.round(target.timeoutMs / 1000)) : 5,
      });

      await conn.connect();
      const latencyMs = Date.now() - start;
      const res = await conn.write('/system/resource/print');
      const data = Array.isArray(res) ? res[0] : res;

      return {
        success: true,
        latencyMs,
        version: data?.version,
        architecture: data?.['architecture-name'],
        boardName: data?.['board-name'],
      };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const classification = classifyDeviceError(err);
      this.logger.warn(`Fallo testConnection API binaria contra ${target.host}:${target.port} - ${classification.code}: ${classification.message}`);

      return {
        success: false,
        latencyMs,
        errorCode: classification.code,
        errorMessage: classification.message,
      };
    } finally {
      if (conn) {
        try {
          await conn.close();
        } catch {
          // Ignorar error al cerrar socket
        }
      }
    }
  }

  async getSystemResource(target: TransportConnectionTarget): Promise<SystemResourceMetrics> {
    let conn: any = null;
    try {
      const port = target.port === 443 || target.port === 80 ? 8728 : target.port;
      conn = new RouterOSAPI({
        host: target.host,
        user: target.username,
        password: target.password,
        port,
        timeout: target.timeoutMs ? Math.max(1, Math.round(target.timeoutMs / 1000)) : 5,
      });

      await conn.connect();
      const res = await conn.write('/system/resource/print');
      const data = Array.isArray(res) ? res[0] : res;

      let temperature: number | undefined;
      let voltage: number | undefined;

      try {
        const health = await conn.write('/system/health/print');
        const healthData = Array.isArray(health) ? health : [health];
        for (const item of healthData) {
          if (item?.name === 'temperature') temperature = parseFloat(item.value);
          if (item?.name === 'voltage') voltage = parseFloat(item.value);
        }
      } catch {
        // Ignorar si no hay health
      }

      return {
        version: data?.version || '',
        uptimeSeconds: this.parseUptime(data?.uptime || '0s'),
        cpuLoad: parseFloat(data?.['cpu-load'] || '0'),
        freeMemoryBytes: parseInt(data?.['free-memory'] || '0', 10),
        totalMemoryBytes: parseInt(data?.['total-memory'] || '0', 10),
        freeHddBytes: parseInt(data?.['free-hdd-space'] || '0', 10),
        totalHddBytes: parseInt(data?.['total-hdd-space'] || '0', 10),
        boardName: data?.['board-name'] || '',
        architectureName: data?.['architecture-name'] || '',
        temperature,
        voltage,
      };
    } finally {
      if (conn) {
        try {
          await conn.close();
        } catch {
          // Ignorar
        }
      }
    }
  }

  async query(target: TransportConnectionTarget, path: string, params?: Record<string, any>): Promise<any> {
    let conn: any = null;
    try {
      const port = target.port === 443 || target.port === 80 ? 8728 : target.port;
      conn = new RouterOSAPI({
        host: target.host,
        user: target.username,
        password: target.password,
        port,
        timeout: target.timeoutMs ? Math.max(1, Math.round(target.timeoutMs / 1000)) : 5,
      });

      await conn.connect();
      const cmd = path.endsWith('/print') ? path : `${path}/print`;
      const queryParams: string[] = [];
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          queryParams.push(`?${k}=${v}`);
        }
      }
      return await conn.write(cmd, queryParams);
    } finally {
      if (conn) {
        try {
          await conn.close();
        } catch {
          // Ignorar
        }
      }
    }
  }

  private parseUptime(uptimeStr: string): number {
    if (!uptimeStr) return 0;
    let totalSeconds = 0;
    const weeks = uptimeStr.match(/(\d+)w/);
    const days = uptimeStr.match(/(\d+)d/);
    const hours = uptimeStr.match(/(\d+)h/);
    const mins = uptimeStr.match(/(\d+)m/);
    const secs = uptimeStr.match(/(\d+)s/);

    if (weeks) totalSeconds += parseInt(weeks[1], 10) * 604800;
    if (days) totalSeconds += parseInt(days[1], 10) * 86400;
    if (hours) totalSeconds += parseInt(hours[1], 10) * 3600;
    if (mins) totalSeconds += parseInt(mins[1], 10) * 60;
    if (secs) totalSeconds += parseInt(secs[1], 10);

    if (totalSeconds === 0 && uptimeStr.includes(':')) {
      const parts = uptimeStr.split(':').map((p) => parseInt(p, 10));
      if (parts.length === 3) {
        totalSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
    }

    return totalSeconds;
  }
}
