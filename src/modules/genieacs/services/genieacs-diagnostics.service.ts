import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { GenieAcsClient } from '../genieacs-client';
import { GenieAcsParameterWriteService } from './genieacs-parameter-write.service';
import { diagnosticFieldMap, neighboringWifiResultBasePath, traceRouteHopBasePath } from './tr069-paths.util';
import {
  DiagnosticRouteHop,
  DiagnosticStatusResult,
  DiagnosticType,
  DiagnosticWifiNeighbor,
  TriggerDiagnosticInput,
} from '../dto/diagnostics.dto';

/**
 * Motor de diagnósticos TR-143 (§2.2/§3.10/§3.15 del plan) -- Ping,
 * Traceroute, Download, Upload, Site Survey. El backend NO espera a que el
 * diagnóstico termine (algunos, como un speedtest, pueden tardar bastante
 * más que cualquier timeout HTTP razonable): `triggerDiagnostic` solo
 * encola el `DiagnosticsState=Requested`, y el frontend hace polling contra
 * `getDiagnosticStatus` hasta ver "COMPLETE"/"ERROR".
 */
@Injectable()
export class GenieAcsDiagnosticsService {
  constructor(
    @Optional()
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
    private readonly writeService: GenieAcsParameterWriteService,
  ) {}

  private getClient(): GenieAcsClient {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'El servidor GenieACS no está configurado (falta GENIEACS_NBI_BASE_URL o GENIEACS_NBI_API_KEY).',
      );
    }
    return this.client;
  }

  async triggerDiagnostic(
    deviceId: string,
    type: DiagnosticType,
    input: TriggerDiagnosticInput,
    actor: string,
  ): Promise<void> {
    const client = this.getClient();
    const status = await client.getDeviceStatus(deviceId);
    const map = diagnosticFieldMap(type, status.isTR181);
    if (!map) {
      throw new BadRequestException(
        `Este equipo no soporta el diagnóstico ${type} (no estandarizado en su modelo de datos TR-069).`,
      );
    }

    const parameterValues: Array<[string, string, string]> = [];
    switch (type) {
      case 'PING':
        if (!input.host) throw new BadRequestException('El diagnóstico PING requiere un host de destino.');
        parameterValues.push([map.triggerPaths.host, input.host, 'xsd:string']);
        parameterValues.push([
          map.triggerPaths.numberOfRepetitions,
          String(input.numberOfRepetitions ?? 4),
          'xsd:unsignedInt',
        ]);
        break;
      case 'TRACEROUTE':
        if (!input.host) throw new BadRequestException('El diagnóstico TRACEROUTE requiere un host de destino.');
        parameterValues.push([map.triggerPaths.host, input.host, 'xsd:string']);
        break;
      case 'DOWNLOAD':
        if (!input.downloadUrl) throw new BadRequestException('El diagnóstico DOWNLOAD requiere una downloadUrl.');
        parameterValues.push([map.triggerPaths.downloadUrl, input.downloadUrl, 'xsd:string']);
        break;
      case 'UPLOAD':
        if (!input.uploadUrl || !input.testFileLength) {
          throw new BadRequestException('El diagnóstico UPLOAD requiere uploadUrl y testFileLength.');
        }
        parameterValues.push([map.triggerPaths.uploadUrl, input.uploadUrl, 'xsd:string']);
        parameterValues.push([map.triggerPaths.testFileLength, String(input.testFileLength), 'xsd:unsignedInt']);
        break;
      case 'SITE_SURVEY':
        // Sin parámetros de entrada -- solo dispara el escaneo del entorno RF.
        break;
    }
    parameterValues.push([map.statePath, 'Requested', 'xsd:string']);

    try {
      await client.setParameterValues(deviceId, parameterValues);
    } catch (error: any) {
      await this.writeService.auditAction(
        deviceId,
        { actor, action: 'DIAGNOSTIC_RUN' },
        { parameterPath: map.statePath, newValue: type },
        'ERROR',
        error?.message,
      );
      throw error;
    }
    await this.writeService.auditAction(
      deviceId,
      { actor, action: 'DIAGNOSTIC_RUN' },
      { parameterPath: map.statePath, newValue: type },
      'OK',
    );
  }

  async getDiagnosticStatus(deviceId: string, type: DiagnosticType): Promise<DiagnosticStatusResult> {
    const client = this.getClient();
    const status = await client.getDeviceStatus(deviceId);
    const map = diagnosticFieldMap(type, status.isTR181);
    if (!map) {
      return { status: 'NOT_SUPPORTED' };
    }

    const allPaths = [map.statePath, ...Object.values(map.resultPaths)];
    const values = await client.getParameterValues(deviceId, allPaths);
    const state = values[map.statePath];

    if (state === undefined) {
      return { status: 'NOT_SUPPORTED' };
    }
    if (state === 'None' || state === '') {
      return { status: 'NOT_STARTED' };
    }
    if (state.startsWith('Error')) {
      return { status: 'ERROR', errorMessage: state };
    }
    if (state !== 'Complete') {
      // "Requested", "Connecting", "Somestate_vendor_specific", etc. -- el
      // diagnóstico está en curso, ninguno de estos estados intermedios es
      // relevante mostrarlo literal al usuario, solo que sigue corriendo.
      return { status: 'RUNNING' };
    }

    const result: Record<string, string | number | undefined> = {};
    for (const [key, path] of Object.entries(map.resultPaths)) {
      const raw = values[path];
      const asNumber = raw !== undefined ? Number(raw) : undefined;
      result[key] = asNumber !== undefined && Number.isFinite(asNumber) ? asNumber : raw;
    }

    if (type === 'TRACEROUTE') {
      const routeHops = await this.getTraceRouteHops(client, deviceId, status.isTR181, result.routeHopsCount as number);
      return { status: 'COMPLETE', result, routeHops };
    }
    if (type === 'SITE_SURVEY') {
      const neighbors = await this.getWifiNeighbors(client, deviceId, result.resultCount as number);
      return { status: 'COMPLETE', result, neighbors };
    }
    return { status: 'COMPLETE', result };
  }

  private async getTraceRouteHops(
    client: GenieAcsClient,
    deviceId: string,
    isTR181: boolean,
    count: number | undefined,
  ) {
    if (!count || count <= 0) {
      return [];
    }
    const base = traceRouteHopBasePath(isTR181);
    const paths: string[] = [];
    for (let i = 1; i <= count; i++) {
      paths.push(`${base}.${i}.Host`, `${base}.${i}.HostAddress`);
    }
    const values = await client.getParameterValues(deviceId, paths);
    const hops: DiagnosticRouteHop[] = [];
    for (let i = 1; i <= count; i++) {
      hops.push({ host: values[`${base}.${i}.Host`], hostAddress: values[`${base}.${i}.HostAddress`] });
    }
    return hops;
  }

  private async getWifiNeighbors(client: GenieAcsClient, deviceId: string, count: number | undefined) {
    if (!count || count <= 0) {
      return [];
    }
    const base = neighboringWifiResultBasePath();
    const paths: string[] = [];
    for (let i = 1; i <= count; i++) {
      paths.push(`${base}.${i}.SSID`, `${base}.${i}.Channel`, `${base}.${i}.SignalStrength`, `${base}.${i}.BSSID`);
    }
    const values = await client.getParameterValues(deviceId, paths);
    const neighbors: DiagnosticWifiNeighbor[] = [];
    for (let i = 1; i <= count; i++) {
      const channel = values[`${base}.${i}.Channel`];
      const signal = values[`${base}.${i}.SignalStrength`];
      neighbors.push({
        ssid: values[`${base}.${i}.SSID`],
        channel: channel !== undefined ? Number(channel) : undefined,
        signalStrength: signal !== undefined ? Number(signal) : undefined,
        bssid: values[`${base}.${i}.BSSID`],
      });
    }
    return neighbors;
  }
}
