import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'ssh2';
import {
  IRouterOsTransport,
  TransportConnectionTarget,
  ConnectionHandshakeResult,
  SystemResourceMetrics,
} from '../interfaces/routeros-transport.interface';
import { classifyDeviceError } from '../utils/device-error-classifier.util';

@Injectable()
export class RouterOsSshTransport implements IRouterOsTransport {
  readonly transportType = 'SSH' as const;
  private readonly logger = new Logger(RouterOsSshTransport.name);

  async testConnection(target: TransportConnectionTarget): Promise<ConnectionHandshakeResult> {
    const start = Date.now();
    try {
      const output = await this.executeSshCommand(target, '/system resource print without-paging');
      const latencyMs = Date.now() - start;

      const versionMatch = output.match(/version:\s*([^\r\n]+)/i);
      const archMatch = output.match(/architecture-name:\s*([^\r\n]+)/i);
      const boardMatch = output.match(/board-name:\s*([^\r\n]+)/i);

      return {
        success: true,
        latencyMs,
        version: versionMatch ? versionMatch[1].trim() : undefined,
        architecture: archMatch ? archMatch[1].trim() : undefined,
        boardName: boardMatch ? boardMatch[1].trim() : undefined,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const classification = classifyDeviceError(err);
      this.logger.warn(`Fallo testConnection SSH contra ${target.host}:${target.port} - ${classification.code}: ${classification.message}`);

      return {
        success: false,
        latencyMs,
        errorCode: classification.code,
        errorMessage: classification.message,
      };
    }
  }

  async getSystemResource(target: TransportConnectionTarget): Promise<SystemResourceMetrics> {
    const output = await this.executeSshCommand(target, '/system resource print without-paging');

    const version = this.extractField(output, 'version');
    const uptime = this.extractField(output, 'uptime');
    const cpuLoad = parseFloat(this.extractField(output, 'cpu-load') || '0');
    const freeMemory = parseInt(this.extractField(output, 'free-memory') || '0', 10);
    const totalMemory = parseInt(this.extractField(output, 'total-memory') || '0', 10);
    const freeHdd = parseInt(this.extractField(output, 'free-hdd-space') || '0', 10);
    const totalHdd = parseInt(this.extractField(output, 'total-hdd-space') || '0', 10);
    const boardName = this.extractField(output, 'board-name');
    const archName = this.extractField(output, 'architecture-name');

    let temperature: number | undefined;
    let voltage: number | undefined;

    try {
      const healthOut = await this.executeSshCommand(target, '/system health print without-paging');
      const tempStr = this.extractField(healthOut, 'temperature');
      const voltStr = this.extractField(healthOut, 'voltage');
      if (tempStr) temperature = parseFloat(tempStr);
      if (voltStr) voltage = parseFloat(voltStr);
    } catch {
      // Ignorar si no hay health
    }

    return {
      version,
      uptimeSeconds: this.parseUptime(uptime),
      cpuLoad,
      freeMemoryBytes: freeMemory,
      totalMemoryBytes: totalMemory,
      freeHddBytes: freeHdd,
      totalHddBytes: totalHdd,
      boardName,
      architectureName: archName,
      temperature,
      voltage,
    };
  }

  async query(target: TransportConnectionTarget, path: string): Promise<any> {
    return await this.executeSshCommand(target, path);
  }

  private executeSshCommand(target: TransportConnectionTarget, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const timeoutMs = target.timeoutMs || 8000;
      let timer: NodeJS.Timeout | null = setTimeout(() => {
        conn.end();
        reject(new Error(`Timeout SSH tras ${timeoutMs}ms`));
      }, timeoutMs);

      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            if (timer) clearTimeout(timer);
            conn.end();
            return reject(err);
          }
          let stdout = '';
          let stderr = '';
          stream
            .on('close', () => {
              if (timer) clearTimeout(timer);
              conn.end();
              if (stderr && !stdout) {
                return reject(new Error(stderr.trim()));
              }
              resolve(stdout);
            })
            .on('data', (data: Buffer) => {
              stdout += data.toString('utf8');
            })
            .stderr.on('data', (data: Buffer) => {
              stderr += data.toString('utf8');
            });
        });
      });

      conn.on('error', (err) => {
        if (timer) clearTimeout(timer);
        conn.end();
        reject(err);
      });

      conn.connect({
        host: target.host,
        port: target.port || 22,
        username: target.username,
        password: target.password,
        readyTimeout: timeoutMs,
      });
    });
  }

  private extractField(output: string, fieldName: string): string {
    const regex = new RegExp(`${fieldName}:\\s*([^\\r\\n]+)`, 'i');
    const match = output.match(regex);
    return match ? match[1].trim() : '';
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

    return totalSeconds;
  }
}
