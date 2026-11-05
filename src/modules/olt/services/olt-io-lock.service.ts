import { ConflictException, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { AsyncLocalStorage } from 'async_hooks';
import { DataSource, QueryRunner } from 'typeorm';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';
import { OltEntity } from '../entities/olt.entity';
import { installOltIoLock } from '../utils/olt-telnet-mutex';

/** Platform session locks serialize the same physical endpoint across tenants/processes. */
@Injectable()
export class OltIoLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OltIoLockService.name);
  private readonly held = new AsyncLocalStorage<{ key: string; runner: QueryRunner }>();
  constructor(@InjectDataSource('platform') private readonly platform: DataSource, private readonly tenant: TenantContextService) {}
  onModuleInit(): void { installOltIoLock((id, action) => this.withLock(id, action), () => this.assertOwned()); }
  onModuleDestroy(): void { installOltIoLock(undefined, undefined); }
  async assertOwned(): Promise<void> {
    const context = this.held.getStore();
    if (context) await context.runner.query('SELECT 1'); // A lost session must abort before another mutation.
  }
  async withLock<T>(id: string, action: () => Promise<T>): Promise<T> {
    const olt = await this.tenant.getDataSource().getRepository(OltEntity).findOneBy({ id });
    if (!olt) throw new ConflictException('No se pudo identificar la OLT física.');
    const key = `olt-io:${olt.viaNodeId || 'direct'}:${olt.host.toLowerCase()}:${olt.port}`;
    if (this.held.getStore()?.key === key) { await this.assertOwned(); return action(); }
    if (this.held.getStore()) throw new ConflictException('No se permite anidar sesiones sobre distintas OLT.');
    const runner = this.platform.createQueryRunner();
    let locked = false;
    try {
      await runner.connect();
      const until = Date.now() + 30000;
      do {
        const rows = await runner.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [key]);
        locked = rows[0]?.locked === true;
        if (!locked) await new Promise(resolve => setTimeout(resolve, 100));
      } while (!locked && Date.now() < until);
      if (!locked) throw new ConflictException('La OLT está ocupada; se agotó la espera de 30 segundos.');
      return await this.held.run({ key, runner }, action);
    } finally {
      try { if (locked && !runner.isReleased) await runner.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]); }
      catch { this.logger.warn('La sesión del lock OLT ya no está disponible al liberar.'); }
      finally { try { await runner.release(); } catch { this.logger.warn('No se pudo liberar la conexión del lock OLT.'); } }
    }
  }
}
