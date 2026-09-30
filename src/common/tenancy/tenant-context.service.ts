import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { DataSource } from 'typeorm';

export interface TenantRequestContext {
  tenantId: string;
  slug: string;
  dataSource: DataSource;
  planFeatures?: Record<string, unknown>;
}

// Wrapper hand-rolled sobre AsyncLocalStorage (sin nueva dependencia, mismo
// espíritu que el resto de este código evitando Passport) — lleva el tenant
// resuelto (DataSource incluido) durante la vida de un request/job/cron, para
// que TenantTypeOrmModule y TenantDataSourceProvider puedan resolver la DB
// correcta sin que los ~25 módulos de negocio sepan que existe multi-tenancy.
@Injectable()
export class TenantContextService {
  private readonly als = new AsyncLocalStorage<TenantRequestContext>();

  run<T>(context: TenantRequestContext, callback: () => T): T {
    return this.als.run(context, callback);
  }

  private getContext(): TenantRequestContext {
    const ctx = this.als.getStore();
    if (!ctx) {
      throw new Error(
        'TenantContextService: no hay contexto de tenant activo. Esto significa que se ' +
          'intentó usar un repositorio/DataSource de tenant fuera de un request que pasó ' +
          'por TenantResolutionMiddleware, o desde un cron/job en background sin haber ' +
          'envuelto el trabajo en tenantContextService.run(...) primero.',
      );
    }
    return ctx;
  }

  getDataSource(): DataSource {
    return this.getContext().dataSource;
  }

  getTenantId(): string {
    return this.getContext().tenantId;
  }

  getSlug(): string {
    return this.getContext().slug;
  }

  hasContext(): boolean {
    return this.als.getStore() !== undefined;
  }

  getPlanFeatures(): Record<string, unknown> {
    return this.getContext().planFeatures || {};
  }

  hasFeature(featureKey: string): boolean {
    const features = this.getPlanFeatures();
    if (!features || Object.keys(features).length === 0) {
      return true;
    }
    if (features['*'] === true || features['all'] === true) {
      return true;
    }
    const normalizedKey = featureKey.toLowerCase();
    for (const [k, v] of Object.entries(features)) {
      if (k.toLowerCase() === normalizedKey) {
        return Boolean(v);
      }
    }
    return false;
  }
}
