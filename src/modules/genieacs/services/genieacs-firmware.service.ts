import { BadRequestException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { GenieAcsClient } from '../genieacs-client';
import { GenieAcsParameterWriteService } from './genieacs-parameter-write.service';
import { MinioStorageService } from '../../storage/minio-storage.service';
import { CpeFirmwareEntity } from '../entities/cpe-firmware.entity';
import { UploadFirmwareMetadataDto } from '../dto/firmware.dto';

const FIRMWARE_BUCKET_PREFIX = 'cpe-firmware';
/** TR-069 estándar (TR-098/TR-181 comparten el mismo catálogo de FileType para Download). */
const FIRMWARE_FILE_TYPE = '1 Firmware Upgrade Image';
/** El CPE puede tardar bastante en bajar+flashear un firmware real -- la URL prefirmada debe seguir viva durante todo ese tiempo. */
const PRESIGNED_URL_EXPIRY_SECONDS = 3600;

export interface PushFirmwareResult {
  softwareVersionBefore?: string;
  targetVersion: string;
}

/**
 * Firmware (§3.17/§2.4 del plan) -- la sección de mayor riesgo de toda la
 * pestaña TR-069/GenieACS: un firmware incorrecto puede dejar el equipo
 * inoperable. Por eso: catálogo propio con checksum real (nunca se
 * autodescubre nada), URL de descarga prefirmada de corta duración (nunca un
 * link público permanente), y auditoría obligatoria con la versión real
 * antes/después (no solo "se mandó el comando"). Restringido a rol ADMIN en
 * el controller -- ni GERENTE ni TECNICO.
 */
@Injectable()
export class GenieAcsFirmwareService {
  constructor(
    @Optional()
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
    private readonly writeService: GenieAcsParameterWriteService,
    private readonly storage: MinioStorageService,
    @InjectRepository(CpeFirmwareEntity)
    private readonly repository: Repository<CpeFirmwareEntity>,
  ) {}

  private getClient(): GenieAcsClient {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'El servidor GenieACS no está configurado (falta GENIEACS_NBI_BASE_URL o GENIEACS_NBI_API_KEY).',
      );
    }
    return this.client;
  }

  async uploadFirmware(
    fileBuffer: Buffer,
    originalName: string,
    metadata: UploadFirmwareMetadataDto,
    actor: string,
  ): Promise<CpeFirmwareEntity> {
    const checksumSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const objectKey = await this.storage.uploadBuffer(fileBuffer, originalName, FIRMWARE_BUCKET_PREFIX, 'application/octet-stream');

    const entry = this.repository.create({
      vendor: metadata.vendor,
      modelPattern: metadata.modelPattern,
      version: metadata.version,
      objectKey,
      checksumSha256,
      fileSizeBytes: fileBuffer.length,
      uploadedBy: actor,
    });
    return this.repository.save(entry);
  }

  async listFirmware(vendor?: string): Promise<CpeFirmwareEntity[]> {
    if (!vendor) {
      return this.repository.find({ order: { vendor: 'ASC', createdAt: 'DESC' } });
    }
    return this.repository
      .createQueryBuilder('f')
      .where('LOWER(f.vendor) = LOWER(:vendor)', { vendor })
      .orderBy('f.createdAt', 'DESC')
      .getMany();
  }

  async deleteFirmware(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  /**
   * Empuja el firmware al equipo. `confirmVersion` ya se validó en el
   * controller (debe coincidir exactamente con `firmware.version`) -- acá se
   * vuelve a verificar como última barrera antes de tocar hardware real.
   */
  async pushFirmware(
    deviceId: string,
    firmwareId: string,
    confirmVersion: string,
    actor: string,
  ): Promise<PushFirmwareResult> {
    const client = this.getClient();
    const firmware = await this.repository.findOne({ where: { id: firmwareId } });
    if (!firmware) {
      throw new NotFoundException('Firmware no encontrado en el catálogo.');
    }
    if (confirmVersion !== firmware.version) {
      throw new BadRequestException(
        `La versión de confirmación no coincide ("${confirmVersion}" vs "${firmware.version}") -- vuelve a escribirla exactamente para continuar.`,
      );
    }

    const status = await client.getDeviceStatus(deviceId);
    const swPath = status.isTR181 ? 'Device.DeviceInfo.SoftwareVersion' : 'InternetGatewayDevice.DeviceInfo.SoftwareVersion';
    const beforeValues = await client.getParameterValues(deviceId, [swPath]);
    const softwareVersionBefore = beforeValues[swPath];

    const downloadUrl = await this.storage.getPresignedUrl(firmware.objectKey, PRESIGNED_URL_EXPIRY_SECONDS);
    const context = { actor, action: 'FIRMWARE_PUSH' as const };

    try {
      await client.downloadFile(deviceId, {
        fileType: FIRMWARE_FILE_TYPE,
        url: downloadUrl,
        fileSize: firmware.fileSizeBytes,
        targetFileName: firmware.version,
      });
    } catch (error: any) {
      await this.writeService.auditAction(
        deviceId,
        context,
        { parameterPath: swPath, oldValue: softwareVersionBefore, newValue: firmware.version },
        'ERROR',
        error?.message,
      );
      throw error;
    }

    await this.writeService.auditAction(
      deviceId,
      context,
      { parameterPath: swPath, oldValue: softwareVersionBefore, newValue: firmware.version },
      'OK',
    );

    return { softwareVersionBefore, targetVersion: firmware.version };
  }
}
