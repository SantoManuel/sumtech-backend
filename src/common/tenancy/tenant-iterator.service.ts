import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantEntity } from '../../modules/platform/entities/tenant.entity';
import { TenantStatus } from '../../modules/platform/enums/tenant-status.enum';
import { TenantContextService } from './tenant-context.service';
import { TenantConnectionManagerService } from './tenant-connection-manager.service';

// Punto de entrada para los @Cron y demás trabajo en background que hoy
// corren una sola vez contra la (antigua) única DataSource global: ahora
// deben correr una vez POR CADA tenant ACTIVE, cada iteración con su propio
// contexto de tenant (misma AsyncLocalStorage que usa un request HTTP normal
// vía TenantResolutionMiddleware). Un tenant que falla no debe abortar el
// resto — se loguea y se sigue con el siguiente.
@Injectable()
export class TenantIteratorService {
  private readonly logger = new Logger(TenantIteratorService.name);

  constructor(
    @InjectRepository(TenantEntity, 'platform')
    private readonly tenantRepository: Repository<TenantEntity>,
    private readonly connectionManager: TenantConnectionManagerService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async runForEachActiveTenant(
    label: string,
    fn: (tenant: TenantEntity) => Promise<void>,
  ): Promise<void> {
    const activeTenants = await this.tenantRepository.find({
      where: { status: TenantStatus.ACTIVE },
    });

    this.logger.log(`[${label}] procesando ${activeTenants.length} tenant(s) activo(s)`);

    for (const tenant of activeTenants) {
      try {
        const dataSource = await this.connectionManager.getDataSourceForTenant(tenant);
        await this.tenantContext.run(
          { tenantId: tenant.id, slug: tenant.slug, dataSource },
          () => fn(tenant),
        );
      } catch (err) {
        this.logger.error(
          `[${label}] falló para tenant '${tenant.slug}': ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }
  }
}
