import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GenieAcsDeviceEntity } from './entities/genieacs-device.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { GenieAcsClient, GenieAcsDeviceStatus } from './genieacs-client';
import { GENIEACS_CLIENT } from './genieacs-client-factory';

/**
 * Resuelve automáticamente qué dispositivo de GenieACS (deviceId TR-069)
 * corresponde a un contrato, a partir del equipo ya asignado en inventario
 * (inv.serial_numbers) — sin que un técnico tenga que vincularlo a mano.
 *
 * Un contrato puede tener varios equipos asignados (ONU, router WiFi
 * adicional, decodificador de TV) y no hay ninguna convención de categoría
 * fiable para distinguir cuál de ellos es el CPE TR-069 — no se asume una.
 * En cambio, se prueba cada serial asignado contra la NBI (findDeviceBySerial)
 * y se toma el primero que realmente exista en GenieACS: un splitter o un
 * control remoto simplemente no va a resolver nada, así que el primero que
 * sí resuelve es, por definición, el CPE gestionado.
 */
@Injectable()
export class GenieAcsDeviceResolverService {
  private readonly logger = new Logger(GenieAcsDeviceResolverService.name);

  constructor(
    @InjectRepository(GenieAcsDeviceEntity)
    private readonly deviceRepository: Repository<GenieAcsDeviceEntity>,
    @InjectRepository(SerialNumberEntity)
    private readonly serialRepository: Repository<SerialNumberEntity>,
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
  ) {}

  /** Devuelve el registro ya guardado sin intentar resolverlo de nuevo — útil para lecturas rápidas (ej. listados). */
  async findByContractId(contractId: string): Promise<GenieAcsDeviceEntity | null> {
    return this.deviceRepository.findOneBy({ contractId });
  }

  /**
   * Resuelve el identificador de un dispositivo en GenieACS buscando directamente
   * por su número de serie (o candidatos GPON), útil para ONUs sin contrato vinculado.
   */
  async resolveBySerialNumber(serialNumber: string): Promise<string | null> {
    if (!this.client || !serialNumber) {
      return null;
    }
    try {
      return await this.client.findDeviceBySerial(serialNumber);
    } catch (error) {
      this.logger.warn(
        `Error buscando en GenieACS por serial "${serialNumber}": ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Obtiene la telemetría viva y tags actuales del dispositivo en GenieACS.
   */
  async getDeviceStatus(deviceId: string): Promise<GenieAcsDeviceStatus | null> {
    if (!this.client || !deviceId) {
      return null;
    }
    try {
      return await this.client.getDeviceStatus(deviceId);
    } catch (error) {
      this.logger.warn(
        `Error obteniendo estado de GenieACS para dispositivo "${deviceId}": ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Asegura que el dispositivo en GenieACS tenga los tags requeridos (ej. TENANT:slug, OLT:nombre).
   * No duplica tags si ya existen.
   */
  async ensureDeviceTags(deviceId: string, tags: string[]): Promise<string[]> {
    if (!this.client || !deviceId || tags.length === 0) {
      return [];
    }
    try {
      const status = await this.client.getDeviceStatus(deviceId);
      const existingTags = status?.tags || [];
      const added: string[] = [];
      for (const tag of tags) {
        if (!existingTags.includes(tag)) {
          await this.client.setDeviceTag(deviceId, tag);
          added.push(tag);
        }
      }
      return added;
    } catch (error) {
      this.logger.warn(
        `Error asegurando tags en GenieACS para "${deviceId}": ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Solicita refresco del árbol CWMP al CPE en GenieACS.
   */
  async refreshDevice(deviceId: string): Promise<void> {
    if (!this.client || !deviceId) {
      return;
    }
    await this.client.refreshObject(deviceId);
  }

  /**
   * Devuelve (y si hace falta, resuelve) el dispositivo GenieACS de un
   * contrato. Devuelve null solo cuando el contrato no tiene ningún equipo
   * asignado todavía en inventario — eso no es un error, es un estado
   * legítimo ("contrato aprobado pero instalación pendiente").
   */
  async resolveForContract(contractId: string): Promise<GenieAcsDeviceEntity | null> {
    const existing = await this.deviceRepository.findOneBy({ contractId });
    if (existing?.genieacsDeviceId) {
      return existing;
    }

    const assignedSerials = await this.serialRepository.find({
      where: { currentContractId: contractId, status: 'ASSIGNED_TO_CLIENT' },
      order: { assignedAt: 'DESC' },
    });

    if (assignedSerials.length === 0) {
      return existing ?? null;
    }

    const record = existing ?? this.deviceRepository.create({ contractId });
    record.serialNumberId = assignedSerials[0].id;

    if (!this.client) {
      record.lastSyncError = 'GenieACS no está configurado (GENIEACS_NBI_BASE_URL / GENIEACS_NBI_API_KEY).';
      return this.deviceRepository.save(record);
    }

    try {
      for (const serial of assignedSerials) {
        const deviceId = await this.client.findDeviceBySerial(serial.serialNumber);
        if (deviceId) {
          record.serialNumberId = serial.id;
          record.genieacsDeviceId = deviceId;
          record.lastSyncAt = new Date();
          record.lastSyncError = null;
          return this.deviceRepository.save(record);
        }
      }

      record.lastSyncAt = new Date();
      record.lastSyncError = 'Ninguno de los equipos asignados a este contrato ha hecho contacto con GenieACS todavía.';
    } catch (error) {
      this.logger.error(
        `Error resolviendo el dispositivo GenieACS del contrato ${contractId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      record.lastSyncError = (error as Error).message;
    }

    return this.deviceRepository.save(record);
  }
}
