import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TenantEntity } from '../../modules/platform/entities/tenant.entity';
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
