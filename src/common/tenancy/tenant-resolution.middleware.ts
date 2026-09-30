import { ForbiddenException, Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContextService } from './tenant-context.service';
import { TenantConnectionManagerService } from './tenant-connection-manager.service';
import { TenantEntity } from '../../modules/platform/entities/tenant.entity';
import { TenantStatus } from '../../modules/platform/enums/tenant-status.enum';

const RESOLUTION_CACHE_TTL_MS = 30_000;
const IGNORED_FIRST_LABELS = new Set(['www']);

interface CachedResolution {
  tenant: TenantEntity | null;
  cachedAt: number;
}

// Resuelve el tenant del request y deja el contexto ALS listo (vía
// TenantContextService.run) para el resto de la cadena de middleware/guards/
// handlers. 404 si el slug no resuelve a ningún tenant, 403 si el tenant
// existe pero está SUSPENDED/CANCELLED.
//
// Dos fuentes del slug, en este orden (Fase 5 del plan multi-tenant):
//   1. Header `X-Tenant-Slug` — lo que mandan sumtech-frontend/
//      sumtech_landingPage_TeleAzua en cada request de su `apiClient`,
//      derivado de SU PROPIO hostname (ej. `ispazua.app.sumtech.com`). Es la
//      fuente real en producción: el navegador le pega a un único dominio de
//      API compartido (`NEXT_PUBLIC_API_URL`), así que el `Host` que llega
//      aquí es el de la API, no el del frontend — el `Host` del request NUNCA
//      lleva el slug del tenant en ese caso.
//   2. `Host` (primer label) — fallback para curl/pruebas directas contra el
//      backend (`Host: ispazua.app.localhost:4000`) y para el caso en que la
//      propia API llegue a ruteare por subdominio en el futuro.
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  // Cache corto en memoria (no por request) para no pegarle a Postgres en cada
  // request — un tenant recién suspendido puede tardar hasta RESOLUTION_CACHE_TTL_MS
  // en reflejarse, aceptable para esta fase.
  private readonly resolutionCache = new Map<string, CachedResolution>();

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly connectionManager: TenantConnectionManagerService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const slug = this.extractSlugFromHeader(req.headers['x-tenant-slug']) || this.extractSlug(req.headers.host);

    if (!slug) {
      throw new NotFoundException('No se pudo determinar el tenant a partir del host de la petición');
    }

    const tenant = await this.resolveWithCache(slug);

    if (!tenant) {
      throw new NotFoundException(`No existe ningún tenant con el subdominio '${slug}'`);
    }

    if (tenant.status === TenantStatus.SUSPENDED || tenant.status === TenantStatus.CANCELLED) {
      throw new ForbiddenException(`El tenant '${slug}' no está activo (estado: ${tenant.status})`);
    }

    const dataSource = await this.connectionManager.getDataSourceForTenant(tenant);
    const planFeatures = (tenant.plan?.features as Record<string, unknown>) || {};

    this.tenantContext.run(
      {
        tenantId: tenant.id,
        slug: tenant.slug,
        dataSource,
        planFeatures,
      },
      () => next(),
    );
  }

  private extractSlugFromHeader(header: string | string[] | undefined): string | null {
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) return null;
    const slug = value.trim().toLowerCase();
    return slug || null;
  }

  private extractSlug(hostHeader: string | undefined): string | null {
    if (!hostHeader) return null;
    const hostWithoutPort = hostHeader.split(':')[0];
    const firstLabel = hostWithoutPort.split('.')[0]?.toLowerCase();
    if (!firstLabel || IGNORED_FIRST_LABELS.has(firstLabel)) return null;
    return firstLabel;
  }

  private async resolveWithCache(slug: string): Promise<TenantEntity | null> {
    const cached = this.resolutionCache.get(slug);
    if (cached && Date.now() - cached.cachedAt < RESOLUTION_CACHE_TTL_MS) {
      return cached.tenant;
    }

    const tenant = await this.connectionManager.resolveTenantBySlug(slug);
    this.resolutionCache.set(slug, { tenant, cachedAt: Date.now() });
    return tenant;
  }
}
