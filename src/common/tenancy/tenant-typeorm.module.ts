import { DynamicModule, Module, Provider } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntitySchema, ObjectLiteral, Repository } from 'typeorm';
import { TenantContextService } from './tenant-context.service';
import { TenancyModule } from './tenancy.module';

type EntityClassOrSchema = (new (...args: any[]) => ObjectLiteral) | EntitySchema<any>;

// Reemplazo drop-in de TypeOrmModule.forFeature(entities). Por cada entidad
// registra un provider SINGLETON (nunca Scope.REQUEST — evita que el árbol de
// DI se vuelva request-scoped) bajo el mismo token que @InjectRepository(Entity)
// espera (getRepositoryToken, la misma función real de @nestjs/typeorm — nunca
// reimplementada a mano). El provider es un Proxy genérico: cualquier acceso a
// propiedad/método se resuelve contra tenantContext.getDataSource().getRepository(Entity)
// EN EL MOMENTO de la llamada (TypeORM ya cachea repos por DataSource
// internamente, no hace falta una capa de cache propia aquí). Efecto neto: los
// servicios existentes con `@InjectRepository(Entity)` no cambian una sola
// línea — solo la línea `imports: [TypeOrmModule.forFeature([...])]` de cada
// módulo pasa a `TenantTypeOrmModule.forFeature([...])`.
function createTenantRepositoryProvider(entity: EntityClassOrSchema): Provider {
  return {
    provide: getRepositoryToken(entity as any),
    useFactory: (tenantContext: TenantContextService): Repository<any> => {
      return new Proxy({} as Repository<any>, {
        get(_target, prop, _receiver) {
          // Ver el guard/comentario completo en tenant-datasource.provider.ts:
          // exploradores internos de Nest (BullMQ, schedule, thenable-check)
          // recorren todos los providers ya instanciados al arrancar, antes
          // de que exista contexto de tenant.
          if (!tenantContext.hasContext()) {
            return undefined;
          }
          const repo = tenantContext.getDataSource().getRepository(entity as any);
          const value = Reflect.get(repo, prop, repo);
          return typeof value === 'function' ? value.bind(repo) : value;
        },
        set(_target, prop, value) {
          const repo = tenantContext.getDataSource().getRepository(entity as any);
          return Reflect.set(repo, prop, value, repo);
        },
        has(_target, prop) {
          return Reflect.has(tenantContext.getDataSource().getRepository(entity as any), prop);
        },
      });
    },
    inject: [TenantContextService],
  };
}

@Module({})
export class TenantTypeOrmModule {
  static forFeature(entities: EntityClassOrSchema[]): DynamicModule {
    const providers = entities.map(createTenantRepositoryProvider);
    const tokens = entities.map((e) => getRepositoryToken(e as any));
    return {
      module: TenantTypeOrmModule,
      imports: [TenancyModule],
      providers,
      exports: tokens,
    };
  }
}
