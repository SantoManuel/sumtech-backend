import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TenantEntity } from '../../modules/platform/entities/tenant.entity';
import { TenantStatus } from '../../modules/platform/enums/tenant-status.enum';
import { entities as tenantEntities } from '../../config/database.config';

// Cache LRU slug -> DataSource. Cada tenant tiene su propia base de datos en
// el mismo servidor Postgres (mismo host/puerto/usuario que database.config.ts,
// solo cambia el nombre de la DB), reutilizando el mismo array `entities` ya
// exportado por database.config.ts — nunca lo dupliques ni lo reescribas, o
// una entidad nueva quedará sincronizada en la DB de un tenant y no en otra.
@Injectable()
export class TenantConnectionManagerService {
  private readonly logger = new Logger(TenantConnectionManagerService.name);
  // Map preserva orden de inserción: al "tocar" una entrada la reinsertamos al
  // final, así las primeras claves del Map son siempre las menos usadas (LRU).
  private readonly cache = new Map<string, DataSource>();
  private readonly pending = new Map<string, Promise<DataSource>>();
  private readonly rncResolutionCache = new Map<string, { tenant: TenantEntity | null; cachedAt: number }>();
  private readonly RNC_RESOLUTION_CACHE_TTL_MS = 60_000;
  private readonly maxOpenConnections: number;

  constructor(
    @InjectRepository(TenantEntity, 'platform')
    private readonly tenantRepository: Repository<TenantEntity>,
  ) {
    this.maxOpenConnections = parseInt(process.env.TENANT_MAX_OPEN_CONNECTIONS || '20', 10);
  }

  async resolveTenantBySlug(slug: string): Promise<TenantEntity | null> {
    return this.tenantRepository.findOne({
      where: { slug },
      relations: ['plan'],
    });
  }

  /**
   * Resuelve el tenant correspondiente a un RNC (ej. RNCComprador en e-CF B2B de DGII).
   * 1. Consulta platform.tenants directamente por RNC limpio.
   * 2. Fallback de auto-recuperación: si no está en platform.tenants, escanea sec.company_profile
   *    en los tenants activos/trial y auto-actualiza platform.tenants.rnc.
   */
  async resolveTenantByRnc(rnc: string): Promise<TenantEntity | null> {
    if (!rnc) return null;
    const cleanRnc = rnc.replace(/[^0-9]/g, '').trim();
    if (!cleanRnc) return null;

    const cached = this.rncResolutionCache.get(cleanRnc);
    if (cached && Date.now() - cached.cachedAt < this.RNC_RESOLUTION_CACHE_TTL_MS) {
      return cached.tenant;
    }

    let tenant: TenantEntity | null = null;

    // 1. Buscar en platform.tenants directamente
    try {
      tenant = await this.tenantRepository.findOne({
        where: [{ rnc: cleanRnc }, { rnc }],
        relations: ['plan'],
      });

      if (!tenant) {
        tenant = await this.tenantRepository
          .createQueryBuilder('tenant')
          .leftJoinAndSelect('tenant.plan', 'plan')
          .where("REPLACE(tenant.rnc, '-', '') = :cleanRnc", { cleanRnc })
          .getOne();
      }
    } catch (queryErr: any) {
      this.logger.warn(`Error buscando tenant por RNC '${cleanRnc}' en platform.tenants: ${queryErr.message}`);
    }

    // 2. Si no se encontró en platform.tenants, escanear sec.company_profile (self-healing)
    if (!tenant) {
      try {
        const candidateTenants = await this.tenantRepository.find({
          where: [
            { status: TenantStatus.ACTIVE },
            { status: TenantStatus.TRIAL },
          ],
          relations: ['plan'],
        });

        for (const candidate of candidateTenants) {
          try {
            const ds = await this.getDataSourceForTenant(candidate);
            const rows = await ds.query('SELECT rnc FROM sec.company_profile LIMIT 1');
            if (rows && rows.length > 0 && rows[0]?.rnc) {
              const profileRnc = String(rows[0].rnc).replace(/[^0-9]/g, '').trim();
              if (profileRnc === cleanRnc) {
                this.logger.log(
                  `Tenant '${candidate.slug}' identificado para RNC '${cleanRnc}' vía sec.company_profile. Auto-reparando platform.tenants...`,
                );
                candidate.rnc = cleanRnc;
                await this.tenantRepository.save(candidate).catch((err) =>
                  this.logger.warn(`No se pudo auto-actualizar RNC en platform.tenants para ${candidate.slug}: ${err.message}`),
                );
                tenant = candidate;
                break;
              }
            }
          } catch (tenantDbErr: any) {
            this.logger.debug(`Error consultando sec.company_profile en tenant '${candidate.slug}': ${tenantDbErr.message}`);
          }
        }
      } catch (scanErr: any) {
        this.logger.error(`Error en fallback scan de RNC: ${scanErr.message}`);
      }
    }

    this.rncResolutionCache.set(cleanRnc, { tenant, cachedAt: Date.now() });
    return tenant;
  }

  /**
   * Sincroniza el RNC del tenant en platform.tenants e invalida el cache de resolución por RNC.
   */
  async syncTenantRnc(slug: string, rnc: string): Promise<void> {
    if (!slug) return;
    const cleanRnc = rnc ? rnc.replace(/[^0-9]/g, '').trim() : '';
    await this.tenantRepository.update({ slug }, { rnc: cleanRnc || (null as any) });
    if (cleanRnc) {
      this.rncResolutionCache.delete(cleanRnc);
    }
  }

  async getDataSourceForTenant(tenant: TenantEntity): Promise<DataSource> {
    const cached = this.cache.get(tenant.slug);
    if (cached?.isInitialized) {
      this.touch(tenant.slug, cached);
      return cached;
    }

    const inflight = this.pending.get(tenant.slug);
    if (inflight) {
      return inflight;
    }

    const initPromise = this.createDataSource(tenant)
      .then((ds) => {
        this.cache.set(tenant.slug, ds);
        this.evictIfNeeded();
        this.pending.delete(tenant.slug);
        return ds;
      })
      .catch((err) => {
        this.pending.delete(tenant.slug);
        throw err;
      });

    this.pending.set(tenant.slug, initPromise);
    return initPromise;
  }

  private touch(slug: string, ds: DataSource): void {
    this.cache.delete(slug);
    this.cache.set(slug, ds);
  }

  private async createDataSource(tenant: TenantEntity): Promise<DataSource> {
    const ds = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: tenant.dbName,
      entities: tenantEntities,
      synchronize: false,
      logging: process.env.DB_LOGGING === 'true',
    });
    await ds.initialize();
    this.logger.log(`Conexión abierta para tenant '${tenant.slug}' (DB: ${tenant.dbName})`);
    return ds;
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxOpenConnections) {
      const oldestSlug = this.cache.keys().next().value;
      if (!oldestSlug) break;
      const ds = this.cache.get(oldestSlug);
      this.cache.delete(oldestSlug);
      if (ds?.isInitialized) {
        ds.destroy().catch((err) =>
          this.logger.warn(`Error cerrando conexión evicted de '${oldestSlug}': ${err.message}`),
        );
      }
    }
  }
}
