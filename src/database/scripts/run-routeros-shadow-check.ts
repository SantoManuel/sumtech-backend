import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { NetworkNodeEntity } from '../../modules/network/entities/network-node.entity';
import { RouterOsShadowSyncService } from '../../modules/network/routeros-shadow-sync.service';
import { TenantEntity } from '../../modules/platform/entities/tenant.entity';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';
import { TenantConnectionManagerService } from '../../common/tenancy/tenant-connection-manager.service';

/**
 * Fase 05 del plan de integración con Mikrotik: corre en modo sombra contra
 * UN nodo piloto — consulta el estado real vía la API REST de RouterOS y lo
 * compara contra lo que Sumtech tiene en net.network_access, sin aplicar
 * ningún cambio. Requiere:
 *   - Que el nodo tenga managementIp configurado (/dashboard/red > Nodos).
 *   - ROUTEROS_CREDENTIALS con las credenciales de ese nodo (ver
 *     src/modules/network/routeros/routeros-credentials.ts).
 *
 * Uso: npm run shadow-check:routeros -- "<nombre exacto del nodo>" [--tenant=<slug>]
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let tenantSlug: string | undefined;
  let nodeName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tenant' && args[i + 1]) {
      tenantSlug = args[i + 1];
      i++;
    } else if (args[i].startsWith('--tenant=')) {
      tenantSlug = args[i].slice('--tenant='.length);
    } else if (!nodeName && !args[i].startsWith('--')) {
      nodeName = args[i];
    }
  }

  if (!nodeName) {
    throw new Error('Uso: npm run shadow-check:routeros -- "<nombre exacto del nodo>" [--tenant=<slug>]');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const tenantContext = app.get(TenantContextService);
    const connectionManager = app.get(TenantConnectionManagerService);
    let targetDataSource = app.get(DataSource);
    let activeTenant: TenantEntity | null = null;

    if (tenantSlug) {
      const tenantRepo = app.get(DataSource).getRepository(TenantEntity);
      activeTenant = await tenantRepo.findOneBy({ slug: tenantSlug });
      if (!activeTenant) {
        throw new Error(`Tenant con slug "${tenantSlug}" no encontrado.`);
      }
      targetDataSource = await connectionManager.getDataSourceForTenant(activeTenant);
    }

    const runCheck = async (ds: DataSource) => {
      const node = await ds.getRepository(NetworkNodeEntity).findOneBy({ name: nodeName });
      if (!node) {
        throw new Error(`No se encontró ningún nodo con el nombre "${nodeName}".`);
      }

      const shadowSyncService = app.get(RouterOsShadowSyncService);
      return shadowSyncService.checkNode(node.id);
    };

    const summary = activeTenant
      ? await tenantContext.run(
          { tenantId: activeTenant.id, slug: activeTenant.slug, dataSource: targetDataSource },
          () => runCheck(targetDataSource),
        )
      : await runCheck(targetDataSource);

    if (!summary.connectionOk) {
      console.error(`No se pudo conectar al nodo "${summary.nodeName}": ${summary.connectionError}`);
      process.exitCode = 1;
      return;
    }

    console.log(`Nodo "${summary.nodeName}" — ${summary.rows.length} acceso(s) comparado(s) contra el nodo real:\n`);
    for (const row of summary.rows) {
      const marker = row.drift ? '[DESINCRONIZADO]' : '[OK]';
      console.log(`  ${marker} ${row.username || '(sin usuario configurado)'} — Sumtech: ${row.sumtechStatus} — ${row.detail}`);
    }

    const driftCount = summary.rows.filter((row) => row.drift).length;
    console.log(`\n${driftCount} de ${summary.rows.length} acceso(s) con desincronización.`);
    if (driftCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((error) => {
    console.error('Error ejecutando el shadow check de RouterOS:', error.message);
    process.exit(1);
  });
