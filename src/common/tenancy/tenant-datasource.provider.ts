import { Provider } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantContextService } from './tenant-context.service';

// NOTA DE DISEÑO (descubierta al implementar, no estaba prevista así en el
// plan): NO se registra bajo `getDataSourceToken()` (el token real de la
// conexión 'default'), porque esa conexión SIGUE VIVA y activa mientras los
// ~25 módulos de negocio no hayan sido migrados (Fase 2) — TypeOrmCoreModule
// (creado por TypeOrmModule.forRootAsync() en app.module.ts) YA es @Global()
// y ya provee ese mismo token. Registrar un segundo provider @Global() bajo
// el mismo token produce una colisión ambigua de resolución de DI entre dos
// módulos globales. En vez de eso, este Proxy vive bajo un token propio
// (TENANT_DATA_SOURCE) — la Fase 2 debe cambiar cada uno de los ~10 sitios
// que hoy inyectan `DataSource` directo a `@Inject(TENANT_DATA_SOURCE)`
// (una línea por archivo, no "cero cambios", pero sigue sin tocar el resto
// del método: createQueryRunner()/queryRunner.manager funcionan idéntico).
export const TENANT_DATA_SOURCE = Symbol('TENANT_DATA_SOURCE');

export const tenantDataSourceProvider: Provider = {
  provide: TENANT_DATA_SOURCE,
  useFactory: (tenantContext: TenantContextService): DataSource => {
    return new Proxy({} as DataSource, {
      get(_target, prop, _receiver) {
        // Varios mecanismos internos de Nest (BullExplorer de @nestjs/bullmq,
        // el scanner de @nestjs/schedule para @Cron, el propio await/thenable
        // check al instanciar un provider async) recorren TODOS los providers
        // ya instanciados en el contenedor durante el arranque, tocando
        // propiedades arbitrarias (`.then`, `.constructor`, símbolos de
        // metadata de decoradores) de cada instancia — incluida esta, mucho
        // antes de que exista ningún request. No hay forma de distinguir esa
        // introspección legítima de un uso real fuera de contexto solo por
        // qué propiedad se lee, así que fuera de contexto simplemente no se
        // lanza: se devuelve undefined para cualquier propiedad. Un uso real
        // indebido (código de negocio que llama a esto sin pasar por
        // TenantResolutionMiddleware o tenantContext.run()) sigue fallando
        // igual de fuerte más abajo, como `TypeError: X is not a function`.
        if (!tenantContext.hasContext()) {
          return undefined;
        }
        const real = tenantContext.getDataSource();
        const value = Reflect.get(real, prop, real);
        return typeof value === 'function' ? value.bind(real) : value;
      },
      set(_target, prop, value) {
        const real = tenantContext.getDataSource();
        return Reflect.set(real, prop, value, real);
      },
      has(_target, prop) {
        return Reflect.has(tenantContext.getDataSource(), prop);
      },
    });
  },
  inject: [TenantContextService],
};
