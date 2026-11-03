import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkNodeEntity } from '../entities/network-node.entity';
import { RouterOsClientResolverService } from './routeros-client-resolver.service';

export interface TrafficSample {
  timestamp: string;
  rxBps: number;
  txBps: number;
  rxPps?: number;
  txPps?: number;
}

export interface InterfaceTrafficTelemetry {
  nodeId: string;
  nodeName: string;
  interfaceName: string;
  currentRxBps: number;
  currentTxBps: number;
  maxRxBps: number;
  maxTxBps: number;
  avgRxBps: number;
  avgTxBps: number;
  samples: TrafficSample[];
  updatedAt: string;
}

@Injectable()
export class InterfaceTrafficService {
  private readonly logger = new Logger(InterfaceTrafficService.name);

  // Buffer circular en memoria: Map<"nodeId:interfaceName", TrafficSample[]>
  private readonly trafficHistory = new Map<string, TrafficSample[]>();
  private readonly maxSamplesPerInterface = 60; // 60 muestras

  constructor(
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepo: Repository<NetworkNodeEntity>,
    private readonly clientResolver: RouterOsClientResolverService,
  ) {}

  /**
   * Obtiene la lista de interfaces disponibles para monitoreo en el router
   */
  async getNodeInterfaces(nodeId: string): Promise<Array<{ name: string; type: string; running: boolean }>> {
    const node = await this.nodeRepo.findOne({ where: { id: nodeId } });
    if (!node) {
      throw new NotFoundException(`Nodo con identificador "${nodeId}" no encontrado`);
    }

    try {
      const client = await this.clientResolver.resolveClient(node) as any;
      if (typeof client.getInterfaces === 'function') {
        const items = await client.getInterfaces();
        if (Array.isArray(items) && items.length > 0) {
          return items.map((iface: any) => ({
            name: iface.name,
            type: iface.type || 'ether',
            running: !!iface.running,
          }));
        }
      }
    } catch (err: any) {
      this.logger.warn(`No se pudieron consultar interfaces en vivo de ${node.name}: ${err.message}`);
    }

    // Fallback a interfaces por defecto
    return [
      { name: 'ether1', type: 'ether', running: true },
      { name: 'ether2', type: 'ether', running: true },
      { name: 'sfp-sfpplus1', type: 'ether', running: true },
    ];
  }

  /**
   * Obtiene la telemetría en tiempo real y el histórico de tráfico de una interfaz
   */
  async getInterfaceTraffic(nodeId: string, interfaceName: string): Promise<InterfaceTrafficTelemetry> {
    const node = await this.nodeRepo.findOne({ where: { id: nodeId } });
    if (!node) {
      throw new NotFoundException(`Nodo con identificador "${nodeId}" no encontrado`);
    }

    const key = `${nodeId}:${interfaceName}`;
    let currentRx = 0;
    let currentTx = 0;

    try {
      const client = await this.clientResolver.resolveClient(node) as any;

      if (typeof client.getInterfaceTrafficSample === 'function') {
        const sample = await client.getInterfaceTrafficSample(interfaceName);
        currentRx = sample.rxBps || 0;
        currentTx = sample.txBps || 0;
      } else if (client.http && typeof client.buildUrl === 'function') {
        // Sondeo REST RouterOS v7
        const res = await client.http.post(
          client.buildUrl('interface/monitor-traffic'),
          { interface: interfaceName, once: '' },
          client.buildRequestConfig ? client.buildRequestConfig() : {}
        );
        const data = Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : res.data;
        if (data) {
          currentRx = Number(data['rx-bits-per-second'] || data.rxBitsPerSecond || 0);
          currentTx = Number(data['tx-bits-per-second'] || data.txBitsPerSecond || 0);
        }
      }
    } catch (err: any) {
      this.logger.debug(`Sondeo en vivo de ${interfaceName} en ${node.name}: ${err.message}`);
      const existing = this.trafficHistory.get(key);
      if (existing && existing.length > 0) {
        const last = existing[existing.length - 1];
        currentRx = last.rxBps;
        currentTx = last.txBps;
      }
    }

    const sample: TrafficSample = {
      timestamp: new Date().toISOString(),
      rxBps: currentRx,
      txBps: currentTx,
    };

    let history = this.trafficHistory.get(key) || [];
    history.push(sample);

    if (history.length > this.maxSamplesPerInterface) {
      history = history.slice(history.length - this.maxSamplesPerInterface);
    }
    this.trafficHistory.set(key, history);

    const allRx = history.map((s) => s.rxBps);
    const allTx = history.map((s) => s.txBps);
    const maxRxBps = allRx.length > 0 ? Math.max(...allRx) : 0;
    const maxTxBps = allTx.length > 0 ? Math.max(...allTx) : 0;
    const avgRxBps = allRx.length > 0 ? Math.round(allRx.reduce((a, b) => a + b, 0) / allRx.length) : 0;
    const avgTxBps = allTx.length > 0 ? Math.round(allTx.reduce((a, b) => a + b, 0) / allTx.length) : 0;

    return {
      nodeId: node.id,
      nodeName: node.name,
      interfaceName,
      currentRxBps: currentRx,
      currentTxBps: currentTx,
      maxRxBps,
      maxTxBps,
      avgRxBps,
      avgTxBps,
      samples: history,
      updatedAt: sample.timestamp,
    };
  }
}
