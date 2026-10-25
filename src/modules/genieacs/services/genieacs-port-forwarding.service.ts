import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { GenieAcsClient } from '../genieacs-client';
import { GenieAcsParameterWriteService, ParameterChange } from './genieacs-parameter-write.service';
import { OnuTr069PortMappingEntry } from '../dto/onu-tr069-snapshot.dto';
import { AddPortMappingDto } from '../dto/add-port-mapping.dto';
import { pppBasePath, portMappingFieldPaths, wanIpConnectionBasePath } from './tr069-paths.util';

/**
 * Port Forward (§3.3 del plan) -- lectura y escritura viven juntas acá porque
 * ambas necesitan resolver primero, en runtime, CUÁL conexión WAN de TR-098
 * (PPPoE o IP) tiene la tabla PortMapping real -- a diferencia del resto de
 * las secciones, acá no alcanza con un `isTR181` fijo.
 */
@Injectable()
export class GenieAcsPortForwardingService {
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

  /**
   * Devuelve la ruta de la tabla PortMapping (SIN índice, con el punto final
   * para AddObject) o `null` si TR-098 no tiene ninguna conexión WAN creada
   * todavía (equipo recién autorizado, antes de la Etapa 3 de esta ficha).
   */
  private async resolveTableBase(client: GenieAcsClient, deviceId: string, isTR181: boolean): Promise<string | null> {
    if (isTR181) {
      return 'Device.NAT.PortMapping';
    }
    const pppBase = pppBasePath(false);
    if (await client.objectInstanceExists(deviceId, pppBase)) {
      return `${pppBase}.PortMapping`;
    }
    const ipBase = wanIpConnectionBasePath();
    if (await client.objectInstanceExists(deviceId, ipBase)) {
      return `${ipBase}.PortMapping`;
    }
    return null;
  }

  async getPortMappings(deviceId: string): Promise<OnuTr069PortMappingEntry[]> {
    const client = this.getClient();
    const status = await client.getDeviceStatus(deviceId);
    const tableBase = await this.resolveTableBase(client, deviceId, status.isTR181);
    if (!tableBase) {
      return [];
    }

    const countPath = `${tableBase}NumberOfEntries`;
    const countValues = await client.getParameterValues(deviceId, [countPath]);
    const count = parseInt(countValues[countPath] || '0', 10);
    if (!Number.isFinite(count) || count === 0) {
      return [];
    }

    const paths: string[] = [];
    for (let i = 1; i <= count; i++) {
      paths.push(...Object.values(portMappingFieldPaths(status.isTR181, tableBase, i)));
    }
    const values = await client.getParameterValues(deviceId, paths);

    const entries: OnuTr069PortMappingEntry[] = [];
    for (let i = 1; i <= count; i++) {
      const f = portMappingFieldPaths(status.isTR181, tableBase, i);
      entries.push({
        index: i,
        enabled: parseBoolean(values[f.enabled]),
        protocol: values[f.protocol],
        externalPort: parseNonNegativeInt(values[f.externalPort]),
        externalPortEndRange: parseNonNegativeInt(values[f.externalPortEndRange]),
        internalPort: parseNonNegativeInt(values[f.internalPort]),
        internalClient: values[f.internalClient],
        description: values[f.description],
        leaseDuration: parseNonNegativeInt(values[f.leaseDuration]),
      });
    }
    return entries;
  }

  /**
   * Crea una regla nueva. `SetParameterValues` no puede crear instancias --
   * primero `addObject`, luego se le escriben los campos al índice nuevo.
   * Se asume indexación secuencial (nuevo índice = NumberOfEntries antes del
   * alta + 1) -- confirmado así para las tablas WAN de este tenant; si algún
   * CPE reutilizara huecos de índices borrados en vez de agregar al final,
   * esto podría apuntar al índice equivocado. No observado hasta ahora.
   */
  async addPortMapping(deviceId: string, dto: AddPortMappingDto, actor: string): Promise<{ index: number }> {
    const client = this.getClient();
    const status = await client.getDeviceStatus(deviceId);
    const tableBase = await this.resolveTableBase(client, deviceId, status.isTR181);
    if (!tableBase) {
      throw new BadRequestException(
        'Este equipo todavía no tiene una conexión WAN configurada (ver Etapa 3 de esta ficha) -- no se puede agregar una regla de Port Forward.',
      );
    }

    const countPath = `${tableBase}NumberOfEntries`;
    const countValues = await client.getParameterValues(deviceId, [countPath]);
    const currentCount = parseInt(countValues[countPath] || '0', 10);
    const newIndex = (Number.isFinite(currentCount) ? currentCount : 0) + 1;

    await client.addObject(deviceId, `${tableBase}.`);

    const f = portMappingFieldPaths(status.isTR181, tableBase, newIndex);
    const changes: ParameterChange[] = [
      { path: f.enabled, value: 'true', type: 'xsd:boolean' },
      { path: f.protocol, value: dto.protocol, type: 'xsd:string' },
      { path: f.externalPort, value: String(dto.externalPort), type: 'xsd:unsignedInt' },
      { path: f.internalPort, value: String(dto.internalPort), type: 'xsd:unsignedInt' },
      { path: f.internalClient, value: dto.internalClient, type: 'xsd:string' },
    ];
    if (dto.externalPortEndRange !== undefined) {
      changes.push({ path: f.externalPortEndRange, value: String(dto.externalPortEndRange), type: 'xsd:unsignedInt' });
    }
    if (dto.description !== undefined) {
      changes.push({ path: f.description, value: dto.description, type: 'xsd:string' });
    }

    await this.writeService.applyParameterChanges(deviceId, changes, { actor, action: 'PORT_FORWARD_ADD' });
    return { index: newIndex };
  }

  async deletePortMapping(deviceId: string, index: number, actor: string): Promise<void> {
    const client = this.getClient();
    const status = await client.getDeviceStatus(deviceId);
    const tableBase = await this.resolveTableBase(client, deviceId, status.isTR181);
    if (!tableBase) {
      throw new BadRequestException('Este equipo no tiene ninguna regla de Port Forward configurada.');
    }

    const path = `${tableBase}.${index}`;
    const context = { actor, action: 'PORT_FORWARD_DELETE' as const };
    try {
      await client.deleteObject(deviceId, path);
    } catch (error: any) {
      await this.writeService.auditAction(deviceId, context, { parameterPath: path }, 'ERROR', error?.message);
      throw error;
    }
    await this.writeService.auditAction(deviceId, context, { parameterPath: path, oldValue: 'existía', newValue: 'eliminada' }, 'OK');
  }
}

function parseNonNegativeInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}
