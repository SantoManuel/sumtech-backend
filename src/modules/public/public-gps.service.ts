import { Injectable, NotFoundException, GoneException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AddressGpsRequestEntity } from '../clients/entities/address-gps-request.entity';
import { AddressEntity } from '../clients/entities/address.entity';

export interface SubmitGpsLocationInput {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

/**
 * Backend de la página pública /ubicacion/[token] — sin autenticación de
 * usuario, solo el token opaco del enlace enviado al cliente. Nunca expone
 * datos del cliente (nombre, dirección, etc.), solo confirma validez del
 * token y recibe las coordenadas.
 */
@Injectable()
export class PublicGpsService {
  constructor(
    @InjectRepository(AddressGpsRequestEntity)
    private readonly gpsRequestRepository: Repository<AddressGpsRequestEntity>,
    @InjectRepository(AddressEntity)
    private readonly addressRepository: Repository<AddressEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private async findValidOrThrow(token: string): Promise<AddressGpsRequestEntity> {
    const request = await this.gpsRequestRepository.findOne({ where: { token } });
    if (!request) {
      throw new NotFoundException('Enlace de ubicación no válido');
    }
    if (request.status === 'PENDING' && request.expiresAt.getTime() < Date.now()) {
      request.status = 'EXPIRED';
      await this.gpsRequestRepository.save(request);
    }
    return request;
  }

  async checkToken(token: string): Promise<{ valid: boolean; alreadySubmitted: boolean }> {
    const request = await this.findValidOrThrow(token);
    if (request.status === 'EXPIRED') {
      return { valid: false, alreadySubmitted: false };
    }
    return { valid: true, alreadySubmitted: request.status === 'SUBMITTED' };
  }

  async submitLocation(token: string, input: SubmitGpsLocationInput): Promise<{ success: true }> {
    const request = await this.findValidOrThrow(token);
    if (request.status === 'EXPIRED') {
      throw new GoneException('Este enlace de ubicación ya venció');
    }
    if (request.status === 'SUBMITTED') {
      throw new GoneException('Este enlace de ubicación ya fue usado');
    }

    request.status = 'SUBMITTED';
    request.submittedAt = new Date();
    request.submittedLatitude = input.latitude;
    request.submittedLongitude = input.longitude;
    request.submittedAccuracy = input.accuracy;

    await this.dataSource.transaction(async (manager) => {
      await manager.save(AddressGpsRequestEntity, request);
      await manager.update(AddressEntity, request.addressId, {
        gpsLatitude: input.latitude,
        gpsLongitude: input.longitude,
      });
    });

    return { success: true };
  }
}
