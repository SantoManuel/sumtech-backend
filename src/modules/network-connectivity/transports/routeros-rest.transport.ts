import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import {
  IRouterOsTransport,
  TransportConnectionTarget,
  ConnectionHandshakeResult,
  SystemResourceMetrics,
} from '../interfaces/routeros-transport.interface';
import { classifyDeviceError } from '../utils/device-error-classifier.util';

@Injectable()
export class RouterOsRestTransport implements IRouterOsTransport {
  readonly transportType = 'REST' as const;
  private readonly logger = new Logger(RouterOsRestTransport.name);

  private createClient(target: TransportConnectionTarget): AxiosInstance {
    const protocol = target.useHttps ? 'https' : 'http';
    const baseURL = `${protocol}://${target.host}:${target.port}/rest`;

    return axios.create({
      baseURL,
      auth: {
        username: target.username,
        password: target.password,
      },
      timeout: target.timeoutMs || 5000,
      headers: {
        'Content-Type': 'application/json',
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: false, // Permite certificados auto-firmados comunes en RouterOS
      }),
    });
  }

  async testConnection(target: TransportConnectionTarget): Promise<ConnectionHandshakeResult> {
    const start = Date.now();
    try {
      const client = this.createClient(target);
      const res = await client.get('/system/resource');
      const latencyMs = Date.now() - start;

      const data = Array.isArray(res.data) ? res.data[0] : res.data;

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
      this.logger.warn(`Fallo testConnection REST contra ${target.host}:${target.port} - ${classification.code}: ${classification.message}`);

      return {
        success: false,
        latencyMs,
        errorCode: classification.code,
        errorMessage: classification.message,
      };
    }
  }

  async getSystemResource(target: TransportConnectionTarget): Promise<SystemResourceMetrics> {
    const client = this.createClient(target);
    const res = await client.get('/system/resource');
    const data = Array.isArray(res.data) ? res.data[0] : res.data;

    let temperature: number | undefined;
    let voltage: number | undefined;

    try {
      const healthRes = await client.get('/system/health');
      const healthData = Array.isArray(healthRes.data) ? healthRes.data : [healthRes.data];
      for (const item of healthData) {
        if (item?.name === 'temperature' || item?.type === 'temperature') {
          temperature = parseFloat(item.value);
        }
        if (item?.name === 'voltage' || item?.type === 'voltage') {
          voltage = parseFloat(item.value);
        }
      }
    } catch {
      // /system/health puede no existir en VMs CHR
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
  }

  async query(target: TransportConnectionTarget, path: string, params?: Record<string, any>): Promise<any> {
    const client = this.createClient(target);
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const res = await client.get(normalizedPath, { params });
    return res.data;
  }

  private parseUptime(uptimeStr: string): number {
    if (!uptimeStr) return 0;
    // Formato común de RouterOS: 1w2d3h4m5s, o 02:15:30
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
