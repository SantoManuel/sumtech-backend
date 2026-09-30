import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from '../../modules/platform/entities/tenant.entity';
import { TenantContextService } from './tenant-context.service';
import { TenantConnectionManagerService } from './tenant-connection-manager.service';
import { tenantDataSourceProvider, TENANT_DATA_SOURCE } from './tenant-datasource.provider';
import { TenantIteratorService } from './tenant-iterator.service';

// @Global() para que TenantTypeOrmModule.forFeature(...), usado en cada uno de
// los ~25 módulos de negocio, no tenga que re-importar este módulo cada vez —
// se registra una sola vez desde AppModule.
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity], 'platform')],
  providers: [
    TenantContextService,
    TenantConnectionManagerService,
    tenantDataSourceProvider,
    TenantIteratorService,
  ],
  exports: [
    TenantContextService,
    TenantConnectionManagerService,
    TENANT_DATA_SOURCE,
    TenantIteratorService,
  ],
})
export class TenancyModule {}
