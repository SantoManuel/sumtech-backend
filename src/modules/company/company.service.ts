import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TenantConfigEntity } from './entities/tenant-config.entity';
import { CreateTenantConfigDto } from './dto/create-tenant-config.dto';
import { UpdateTenantConfigDto } from './dto/update-tenant-config.dto';

export interface CompanyFiscalInfo {
  rnc: string;
  razonSocial: string;
  nombreComercial?: string;
  direccion?: string;
  municipio?: string;
  provincia?: string;
  correo?: string;
  telefono?: string;
  website?: string;
}

@Injectable()
export class CompanyService implements OnModuleInit {
  private readonly logger = new Logger(CompanyService.name);

  constructor(
    @InjectRepository(TenantConfigEntity)
    private readonly tenantRepository: Repository<TenantConfigEntity>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    // Asegurar que exista al menos el tenant por defecto al arrancar
    try {
      await this.getDefaultTenant();
    } catch (err: any) {
      this.logger.warn(`Inicialización preventiva de tenant: ${err.message}`);
    }
  }

  /**
   * Obtiene la lista completa de empresas / tenants configurados
   */
  async findAll(activeOnly = false): Promise<TenantConfigEntity[]> {
    const where = activeOnly ? { isActive: true } : {};
    return this.tenantRepository.find({
      where,
      relations: ['country', 'province', 'municipality', 'sector'],
      order: { isDefault: 'DESC', name: 'ASC' },
    });
  }

  /**
   * Busca un tenant por su ID primario UUID
   */
  async findById(id: string): Promise<TenantConfigEntity> {
    const tenant = await this.tenantRepository.findOne({
      where: { id },
      relations: ['country', 'province', 'municipality', 'sector'],
    });
    if (!tenant) {
      throw new NotFoundException(`Empresa con ID "${id}" no encontrada.`);
    }
    return tenant;
  }

  /**
   * Busca un tenant por su código único de identificación
   */
  async findByCode(tenantCode: string): Promise<TenantConfigEntity> {
    const tenant = await this.tenantRepository.findOne({
      where: { tenantCode },
      relations: ['country', 'province', 'municipality', 'sector'],
    });
    if (!tenant) {
      throw new NotFoundException(`Empresa con código "${tenantCode}" no encontrada.`);
    }
    return tenant;
  }

  /**
   * Obtiene la empresa / tenant predeterminado del sistema (isDefault = true).
   * Si no existe, inicializa automáticamente la configuración de Sumtech.
   */
  async getDefaultTenant(): Promise<TenantConfigEntity> {
    let tenant = await this.tenantRepository.findOne({
      where: { isDefault: true },
      relations: ['country', 'province', 'municipality', 'sector'],
    });

    if (!tenant) {
      tenant = await this.tenantRepository.findOne({
        where: { isActive: true },
        relations: ['country', 'province', 'municipality', 'sector'],
        order: { createdAt: 'ASC' },
      });
    }

    if (!tenant) {
      this.logger.log('Sembrando configuración predeterminada de Sumtech...');
      tenant = this.tenantRepository.create({
        tenantCode: 'DEFAULT',
        name: 'Sumtech Telecom',
        companyName: 'SUMTECH TELECOM S.R.L.',
        commercialName: 'SUMTECH FIBRA & TV',
        rnc: '131000000',
        address: 'Av. 27 de Febrero esq. Winston Churchill, Santo Domingo, D.N.',
        phone: '809-555-0199',
        email: 'facturacion@sumtech.com.do',
        supportEmail: 'soporte@sumtech.com.do',
        website: 'https://sumtech.com.do',
        currency: 'DOP',
        timezone: 'America/Santo_Domingo',
        isActive: true,
        isDefault: true,
      });
      tenant = await this.tenantRepository.save(tenant);
    }

    return tenant;
  }

  /**
   * Crea una nueva empresa / tenant (Multi-empresa)
   */
  async create(dto: CreateTenantConfigDto): Promise<TenantConfigEntity> {
    const existing = await this.tenantRepository.findOne({
      where: { tenantCode: dto.tenantCode },
    });
    if (existing) {
      throw new ConflictException(`Ya existe una empresa con el código "${dto.tenantCode}".`);
    }

    return await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(TenantConfigEntity);

      if (dto.isDefault) {
        // Desactivar el flag isDefault de las demás empresas
        await repo.update({ isDefault: true }, { isDefault: false });
      }

      const newTenant = repo.create({
        ...dto,
        currency: dto.currency || 'DOP',
        timezone: dto.timezone || 'America/Santo_Domingo',
        isActive: dto.isActive !== undefined ? dto.isActive : true,
        isDefault: dto.isDefault || false,
        settings: dto.settings || {},
      });

      const saved = await repo.save(newTenant);
      this.eventEmitter.emit('company.tenant.created', { tenantId: saved.id, tenantCode: saved.tenantCode });
      return this.findById(saved.id);
    });
  }

  /**
   * Actualiza los datos institucionales, fiscales o de contacto de una empresa / tenant
   */
  async update(id: string, dto: UpdateTenantConfigDto): Promise<TenantConfigEntity> {
    const tenant = await this.findById(id);

    if (dto.tenantCode && dto.tenantCode !== tenant.tenantCode) {
      const duplicate = await this.tenantRepository.findOne({
        where: { tenantCode: dto.tenantCode },
      });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(`El código de empresa "${dto.tenantCode}" ya está en uso.`);
      }
    }

    return await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(TenantConfigEntity);

      if (dto.isDefault && !tenant.isDefault) {
        await repo.update({ isDefault: true }, { isDefault: false });
      }

      Object.assign(tenant, dto);
      const saved = await repo.save(tenant);
      this.eventEmitter.emit('company.tenant.updated', { tenantId: saved.id, tenantCode: saved.tenantCode });
      return this.findById(saved.id);
    });
  }

  /**
   * Establece un tenant específico como el predeterminado global del ERP
   */
  async setDefault(id: string): Promise<TenantConfigEntity> {
    const tenant = await this.findById(id);

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(TenantConfigEntity);
      await repo.update({ isDefault: true }, { isDefault: false });
      await repo.update({ id }, { isDefault: true });
    });

    this.eventEmitter.emit('company.tenant.default_changed', { tenantId: id, tenantCode: tenant.tenantCode });
    return this.findById(id);
  }

  /**
   * Retorna la proyección formateada de información fiscal para consumo directo de DGII y generadores PDF
   */
  async getCompanyFiscalInfo(tenantCode?: string): Promise<CompanyFiscalInfo> {
    const tenant = tenantCode ? await this.findByCode(tenantCode) : await this.getDefaultTenant();

    return {
      rnc: tenant.rnc,
      razonSocial: tenant.companyName,
      nombreComercial: tenant.commercialName || tenant.companyName,
      direccion: tenant.address,
      municipio: tenant.municipality?.code || '010100',
      provincia: tenant.province?.code || '010000',
      correo: tenant.email,
      telefono: tenant.phone,
      website: tenant.website,
    };
  }
}
