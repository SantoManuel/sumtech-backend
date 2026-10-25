import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { GenieAcsClient } from '../genieacs-client';
import { GenieAcsParameterWriteService, ParameterChange } from './genieacs-parameter-write.service';
import {
  lanDhcpServerPaths,
  lanEthernetInterfaceBasePath,
  lanEthernetInterfaceCountPath,
  pppBasePath,
  wirelessLanPaths,
  wlanConfigurationCountPath,
} from './tr069-paths.util';
import { UpdatePppInterfaceDto } from '../dto/update-ppp-interface.dto';
import { UpdateLanDhcpServerDto } from '../dto/update-lan-dhcp-server.dto';
import { UpdateWirelessLanDto } from '../dto/update-wireless-lan.dto';

export interface SectionWriteResult {
  appliedFields: string[];
  /** Campos recibidos que este modelo de datos (TR-098/TR-181) no soporta -- se ignoran, nunca se intenta adivinar un OID. */
  skippedFields: string[];
}

/**
 * Escritura real sobre las 4 secciones del Paso 3 del plan (PPP Interface,
 * LAN DHCP Server, LAN Ports, Wireless LAN avanzado) -- todas reusan
 * `GenieAcsParameterWriteService` (mismo patrón de auditoría + redacción de
 * secretos ya probado) y las MISMAS rutas de `tr069-paths.util` que usa la
 * lectura, para que lectura y escritura nunca diverjan.
 */
@Injectable()
export class GenieAcsSectionWriteService {
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

  // ---------------------------------------------------------------------
  // §3.2 PPP Interface
  // ---------------------------------------------------------------------

  async updatePppInterface(deviceId: string, dto: UpdatePppInterfaceDto, actor: string): Promise<SectionWriteResult> {
    const client = this.getClient();
    const status = await client.getDeviceStatus(deviceId);
    const base = pppBasePath(status.isTR181);

    const exists = await client.objectInstanceExists(deviceId, base);
    if (!exists) {
      throw new BadRequestException(
        'Este equipo no tiene una interfaz PPP configurada (el WAN no está en modo PPPoE) -- no hay nada que editar aquí.',
      );
    }

    const changes: ParameterChange[] = [];
    const skippedFields: string[] = [];

    if (dto.username !== undefined) changes.push({ path: `${base}.Username`, value: dto.username, type: 'xsd:string' });
    if (dto.password !== undefined) changes.push({ path: `${base}.Password`, value: dto.password, type: 'xsd:string' });

    // serviceName/connectionTrigger/DNS override son conceptos de TR-098 que
    // TR-181 no estandariza en Device.PPP.Interface -- se ignoran en vez de
    // escribir una ruta que el equipo rechazaría con un fault confuso.
    if (dto.serviceName !== undefined) {
      if (status.isTR181) {
        skippedFields.push('serviceName');
      } else {
        changes.push({ path: `${base}.ServiceName`, value: dto.serviceName, type: 'xsd:string' });
      }
    }
    if (dto.connectionTrigger !== undefined) {
      if (status.isTR181) {
        skippedFields.push('connectionTrigger');
      } else {
        changes.push({ path: `${base}.ConnectionTrigger`, value: dto.connectionTrigger, type: 'xsd:string' });
      }
    }
    if (dto.dns1 !== undefined) {
      if (status.isTR181) {
        skippedFields.push('dns1');
        if (dto.dns2 !== undefined) skippedFields.push('dns2');
      } else {
        const servers = [dto.dns1, dto.dns2].filter(Boolean).join(',');
        changes.push({ path: `${base}.DNSOverrideAllowed`, value: 'true', type: 'xsd:boolean' });
        changes.push({ path: `${base}.DNSEnabled`, value: 'true', type: 'xsd:boolean' });
        changes.push({ path: `${base}.DNSServers`, value: servers, type: 'xsd:string' });
      }
    }

    await this.writeService.applyParameterChanges(deviceId, changes, { actor, action: 'TR069_PARAMETER_CHANGE' });

    return { appliedFields: changes.map((c) => c.path), skippedFields };
  }

  // ---------------------------------------------------------------------
  // §3.5 LAN DHCP Server
  // ---------------------------------------------------------------------

  async updateLanDhcpServer(deviceId: string, dto: UpdateLanDhcpServerDto, actor: string): Promise<SectionWriteResult> {
    const client = this.getClient();
    const status = await client.getDeviceStatus(deviceId);
    const paths = lanDhcpServerPaths(status.isTR181);

    const changes: ParameterChange[] = [];
    if (dto.enabled !== undefined) changes.push({ path: paths.enabled, value: String(dto.enabled), type: 'xsd:boolean' });
    if (dto.minAddress !== undefined) changes.push({ path: paths.minAddress, value: dto.minAddress, type: 'xsd:string' });
    if (dto.maxAddress !== undefined) changes.push({ path: paths.maxAddress, value: dto.maxAddress, type: 'xsd:string' });
    if (dto.subnetMask !== undefined) changes.push({ path: paths.subnetMask, value: dto.subnetMask, type: 'xsd:string' });
    if (dto.domainName !== undefined) changes.push({ path: paths.domainName, value: dto.domainName, type: 'xsd:string' });
    if (dto.ipRouters !== undefined) changes.push({ path: paths.ipRouters, value: dto.ipRouters, type: 'xsd:string' });
    if (dto.dns1 !== undefined || dto.dns2 !== undefined) {
      const servers = [dto.dns1, dto.dns2].filter(Boolean).join(',');
      changes.push({ path: paths.dnsServers, value: servers, type: 'xsd:string' });
    }

    await this.writeService.applyParameterChanges(deviceId, changes, { actor, action: 'TR069_PARAMETER_CHANGE' });
    return { appliedFields: changes.map((c) => c.path), skippedFields: [] };
  }

  // ---------------------------------------------------------------------
  // §3.6 LAN Ports
  // ---------------------------------------------------------------------

  async toggleLanPort(deviceId: string, portIndex: number, enabled: boolean, actor: string): Promise<void> {
    const client = this.getClient();
    const status = await client.getDeviceStatus(deviceId);
    const countPath = lanEthernetInterfaceCountPath(status.isTR181);
    const countValues = await client.getParameterValues(deviceId, [countPath]);
    const count = parseInt(countValues[countPath] || '0', 10);

    if (!Number.isFinite(count) || portIndex < 1 || portIndex > count) {
      throw new BadRequestException(
        `Este equipo reporta ${Number.isFinite(count) ? count : 0} puerto(s) LAN -- el puerto #${portIndex} no existe.`,
      );
    }

    const base = lanEthernetInterfaceBasePath(status.isTR181);
    const path = `${base}.${portIndex}.Enable`;
    await this.writeService.applyParameterChanges(
      deviceId,
      [{ path, value: String(enabled), type: 'xsd:boolean' }],
      { actor, action: 'LAN_PORT_TOGGLE' },
    );
  }

  // ---------------------------------------------------------------------
  // §3.8 Wireless LAN (avanzado)
  // ---------------------------------------------------------------------

  async updateWirelessLan(
    deviceId: string,
    ssidIndex: number,
    dto: UpdateWirelessLanDto,
    actor: string,
  ): Promise<SectionWriteResult> {
    const client = this.getClient();
    const status = await client.getDeviceStatus(deviceId);
    const countPath = wlanConfigurationCountPath(status.isTR181);
    const countValues = await client.getParameterValues(deviceId, [countPath]);
    const count = parseInt(countValues[countPath] || '0', 10);

    if (!Number.isFinite(count) || ssidIndex < 1 || ssidIndex > count) {
      throw new BadRequestException(`Este equipo reporta ${Number.isFinite(count) ? count : 0} radio(s) WiFi -- el SSID #${ssidIndex} no existe.`);
    }

    const paths = wirelessLanPaths(status.isTR181, ssidIndex);
    const changes: ParameterChange[] = [];
    if (dto.enabled !== undefined) changes.push({ path: paths.enabled, value: String(dto.enabled), type: 'xsd:boolean' });
    if (dto.ssidAdvertisementEnabled !== undefined)
      changes.push({ path: paths.ssidAdvertisement, value: String(dto.ssidAdvertisementEnabled), type: 'xsd:boolean' });
    if (dto.channel !== undefined) changes.push({ path: paths.channel, value: String(dto.channel), type: 'xsd:unsignedInt' });
    if (dto.autoChannelEnabled !== undefined)
      changes.push({ path: paths.autoChannel, value: String(dto.autoChannelEnabled), type: 'xsd:boolean' });
    if (dto.regulatoryDomain !== undefined)
      changes.push({ path: paths.regulatoryDomain, value: dto.regulatoryDomain, type: 'xsd:string' });

    await this.writeService.applyParameterChanges(deviceId, changes, { actor, action: 'TR069_PARAMETER_CHANGE' });
    return { appliedFields: changes.map((c) => c.path), skippedFields: [] };
  }
}
