import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { NetworkNodeEntity } from '../../modules/network/entities/network-node.entity';
import { RouterOsShadowSyncService } from '../../modules/network/routeros-shadow-sync.service';

/**
 * Fase 05 del plan de integración con Mikrotik: corre en modo sombra contra
 * UN nodo piloto — consulta el estado real vía la API REST de RouterOS y lo
 * compara contra lo que Sumtech tiene en net.network_access, sin aplicar
 * ningún cambio. Requiere:
 *   - Que el nodo tenga managementIp configurado (/dashboard/red > Nodos).
 *   - ROUTEROS_CREDENTIALS con las credenciales de ese nodo (ver
 *     src/modules/network/routeros/routeros-credentials.ts).
 *
 * Uso: npm run shadow-check:routeros -- "<nombre exacto del nodo>"
 */
async function main(): Promise<void> {
  const nodeName = process.argv[2];
  if (!nodeName) {
    throw new Error('Uso: npm run shadow-check:routeros -- "<nombre exacto del nodo>"');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const dataSource = app.get(DataSource);
    const node = await dataSource.getRepository(NetworkNodeEntity).findOneBy({ name: nodeName });
    if (!node) {
      throw new Error(`No se encontró ningún nodo con el nombre "${nodeName}".`);
    }

    const shadowSyncService = app.get(RouterOsShadowSyncService);
    const summary = await shadowSyncService.checkNode(node.id);

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
