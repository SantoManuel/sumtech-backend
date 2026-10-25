import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { GenieAcsClient } from '../genieacs-client';
import { GenieAcsParameterWriteService } from './genieacs-parameter-write.service';
import { CpeVendorParameterEntity } from '../entities/cpe-vendor-parameter.entity';
import { CreateCpeVendorParameterDto, OnuTr069VendorToggle } from '../dto/vendor-parameter.dto';

/**
 * Security (§3.12) y Miscellaneous (§3.14) del plan -- ningún OID de estas
 * dos secciones está estandarizado, así que en vez de adivinar extensiones
 * de fabricante, se lee/escribe EXCLUSIVAMENTE lo que exista en el catálogo
 * `net.cpe_vendor_parameters` (ver migración 096) para el vendor/modelo real
 * del equipo. Sin fila en el catálogo = sección vacía y honesta ("sin
 * parámetros verificados para este modelo"), nunca un toggle inventado.
 */
@Injectable()
export class GenieAcsVendorParameterService {
  constructor(
    @Optional()
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
    private readonly writeService: GenieAcsParameterWriteService,
    @InjectRepository(CpeVendorParameterEntity)
    private readonly repository: Repository<CpeVendorParameterEntity>,
  ) {}

  private getClient(): GenieAcsClient {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'El servidor GenieACS no está configurado (falta GENIEACS_NBI_BASE_URL o GENIEACS_NBI_API_KEY).',
      );
    }
    return this.client;
  }

  private async findMatchingParameters(
    client: GenieAcsClient,
    deviceId: string,
    category: 'SECURITY' | 'MISCELLANEOUS',
  ): Promise<CpeVendorParameterEntity[]> {
    const status = await client.getDeviceStatus(deviceId);
    if (!status.manufacturer) {
      return [];
    }
    const modelPath = status.isTR181 ? 'Device.DeviceInfo.ModelName' : 'InternetGatewayDevice.DeviceInfo.ModelName';
    const productClassPath = status.isTR181
      ? 'Device.DeviceInfo.ProductClass'
      : 'InternetGatewayDevice.DeviceInfo.ProductClass';
    const values = await client.getParameterValues(deviceId, [modelPath, productClassPath]);
    const modelText = `${values[modelPath] || ''} ${values[productClassPath] || ''}`.toLowerCase();

    const candidates = await this.repository
      .createQueryBuilder('p')
      .where('p.category = :category', { category })
      .andWhere('LOWER(p.vendor) = LOWER(:vendor)', { vendor: status.manufacturer })
      .getMany();

    return candidates.filter((p) => !p.modelPattern || modelText.includes(p.modelPattern.toLowerCase()));
  }

  async getTogglesForDevice(deviceId: string, category: 'SECURITY' | 'MISCELLANEOUS'): Promise<OnuTr069VendorToggle[]> {
    const client = this.getClient();
    const params = await this.findMatchingParameters(client, deviceId, category);
    if (params.length === 0) {
      return [];
    }

    const values = await client.getParameterValues(
      deviceId,
      params.map((p) => p.oidPath),
    );

    return params.map((p) => ({
      parameterKey: p.parameterKey,
      label: p.label,
      category: p.category,
      value: parseBoolean(values[p.oidPath]),
    }));
  }

  async setToggle(deviceId: string, parameterKey: string, value: boolean, actor: string): Promise<void> {
    const client = this.getClient();
    const status = await client.getDeviceStatus(deviceId);
    if (!status.manufacturer) {
      throw new BadRequestException('No se pudo determinar el fabricante de este equipo.');
    }

    const param = await this.repository
      .createQueryBuilder('p')
      .where('LOWER(p.vendor) = LOWER(:vendor)', { vendor: status.manufacturer })
      .andWhere('p.parameterKey = :key', { key: parameterKey })
      .getOne();

    if (!param) {
      throw new BadRequestException(
        `No hay un parámetro "${parameterKey}" verificado en el catálogo para el fabricante "${status.manufacturer}" -- no se puede escribir sin confirmarlo en vivo primero.`,
      );
    }

    await this.writeService.applyParameterChanges(
      deviceId,
      [{ path: param.oidPath, value: String(value), type: param.dataType }],
      { actor, action: 'TR069_PARAMETER_CHANGE' },
    );
  }

  // ---------------------------------------------------------------------
  // Administración del catálogo (solo ADMIN, ver controller)
  // ---------------------------------------------------------------------

  async listCatalog(vendor?: string): Promise<CpeVendorParameterEntity[]> {
    if (!vendor) {
      return this.repository.find({ order: { vendor: 'ASC', category: 'ASC' } });
    }
    return this.repository
      .createQueryBuilder('p')
      .where('LOWER(p.vendor) = LOWER(:vendor)', { vendor })
      .orderBy('p.category', 'ASC')
      .getMany();
  }

  async createCatalogEntry(dto: CreateCpeVendorParameterDto, actor: string): Promise<CpeVendorParameterEntity> {
    const entry = this.repository.create({ ...dto, createdBy: actor });
    return this.repository.save(entry);
  }

  async deleteCatalogEntry(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}
