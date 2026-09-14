import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { ClientEntity } from '../../modules/clients/entities/client.entity';
import { ZoneEntity } from '../../modules/network/entities/zone.entity';
import { NetworkNodeEntity } from '../../modules/network/entities/network-node.entity';
import { ZonesService } from '../../modules/network/zones.service';
import { NetworkNodesService } from '../../modules/network/network-nodes.service';
import { NetworkProvisioningService } from '../../modules/network/network-provisioning.service';
import { parseLegacyNetworkCsv } from './legacy-network-import/csv-parser';
import { buildImportPlan, normalizeDocNumber } from './legacy-network-import/build-import-plan';
import { ClientLookupEntry, ImportException } from './legacy-network-import/types';

/**
 * ETL de la Fase 04 del plan de integración con Mikrotik: toma el export del
 * sistema WISP anterior y crea/actualiza net.zones, net.network_nodes y
 * net.network_access. No toca Plan ni Saldo del cliente — esos quedaron como
 * decisiones de negocio abiertas en el análisis de migración, fuera de
 * alcance de esta fase (solo red).
 *
 * Uso:
 *   npm run import:legacy-network -- <archivo.csv> [--dry-run] [--exceptions-out=ruta.csv]
 *
 * --dry-run          Calcula todo (incluyendo qué zonas/nodos se crearían)
 *                     pero no escribe nada en la base de datos.
 * --exceptions-out    Escribe las filas que no se pudieron importar (documento
 *                     no encontrado, cliente con varios contratos, estado
 *                     desconocido, etc.) a un CSV para revisión manual — nunca
 *                     se descartan en silencio.
 */

interface CliArgs {
  filePath: string;
  dryRun: boolean;
  exceptionsOut?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let dryRun = false;
  let exceptionsOut: string | undefined;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--exceptions-out=')) {
      exceptionsOut = arg.slice('--exceptions-out='.length);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 0) {
    throw new Error('Uso: npm run import:legacy-network -- <archivo.csv> [--dry-run] [--exceptions-out=ruta.csv]');
  }

  return { filePath: positional[0], dryRun, exceptionsOut };
}

/**
 * Lee el archivo intentando UTF-8 primero; si detecta señales de mojibake
 * (tildes mal decodificadas o el carácter de reemplazo U+FFFD), reintenta
 * como latin1 — los exports viejos de paneles web en Windows suelen venir en
 * esa codificación (ver la nota de encoding del análisis de migración).
 */
function readLegacyFile(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  const utf8 = buffer.toString('utf8');
  const looksMangled = utf8.includes('\uFFFD') || new RegExp('\u00c3[\u0080-\u00bf]', 'i').test(utf8);
  return looksMangled ? buffer.toString('latin1') : utf8;
}

function writeExceptionsCsv(outPath: string, exceptions: ImportException[]): void {
  const escape = (value: string) => `"${(value || '').replace(/"/g, '""')}"`;
  const lines = [
    'Fila,Documento,Motivo',
    ...exceptions.map((e) => `${e.rowNumber},${escape(e.docNumber)},${escape(e.reason)}`),
  ];
  fs.writeFileSync(path.resolve(outPath), lines.join('\n'), 'utf8');
}

async function main(): Promise<void> {
  const { filePath, dryRun, exceptionsOut } = parseArgs(process.argv.slice(2));

  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`No se encontró el archivo: ${absolutePath}`);
  }

  const content = readLegacyFile(absolutePath);
  const rows = parseLegacyNetworkCsv(content);
  console.log(`Archivo leído: ${rows.length} fila(s) en ${absolutePath}.`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const dataSource = app.get(DataSource);
    const clientRepo = dataSource.getRepository(ClientEntity);
    const zoneRepo = dataSource.getRepository(ZoneEntity);
    const nodeRepo = dataSource.getRepository(NetworkNodeEntity);
    const zonesService = app.get(ZonesService);
    const nodesService = app.get(NetworkNodesService);
    const provisioningService = app.get(NetworkProvisioningService);

    const clients = await clientRepo.find({ relations: ['contracts'] });
    const clientsByNormalizedDoc = new Map<string, ClientLookupEntry>();
    for (const client of clients) {
      const contracts = (client.contracts || [])
        .filter((contract) => contract.status !== 'TERMINATED')
        .map((contract) => ({ contractId: contract.id, contractNumber: contract.contractNumber }));
      clientsByNormalizedDoc.set(normalizeDocNumber(client.docNumber), {
        clientId: client.id,
        docNumber: client.docNumber,
        contracts,
      });
    }

    const { items, exceptions } = buildImportPlan(rows, clientsByNormalizedDoc);

    console.log(`${items.length} fila(s) listas para importar.`);
    console.log(`${exceptions.length} fila(s) en excepción (requieren revisión manual, no se tocan).`);
    if (dryRun) {
      console.log('Modo --dry-run: no se escribirá nada en la base de datos.');
    }

    const zoneIdByName = new Map<string, string>();
    const plannedNewZoneNames = new Set<string>();
    const nodeIdByName = new Map<string, string>();
    const plannedNewNodeNames = new Set<string>();
    let zonesCreated = 0;
    let nodesCreated = 0;

    const resolveZoneId = async (name: string): Promise<string | undefined> => {
      if (zoneIdByName.has(name)) return zoneIdByName.get(name);
      const existing = await zoneRepo.findOneBy({ name });
      if (existing) {
        zoneIdByName.set(name, existing.id);
        return existing.id;
      }
      if (dryRun) {
        plannedNewZoneNames.add(name);
        return undefined;
      }
      const created = await zonesService.create({ name });
      zoneIdByName.set(name, created.id);
      zonesCreated++;
      return created.id;
    };

    const resolveNodeId = async (name: string, zoneId: string | undefined): Promise<string | undefined> => {
      if (nodeIdByName.has(name)) return nodeIdByName.get(name);
      const existing = await nodeRepo.findOneBy({ name });
      if (existing) {
        nodeIdByName.set(name, existing.id);
        return existing.id;
      }
      if (dryRun) {
        plannedNewNodeNames.add(name);
        return undefined;
      }
      const created = await nodesService.create({ name, zoneId });
      nodeIdByName.set(name, created.id);
      nodesCreated++;
      return created.id;
    };

    for (const item of items) {
      const zoneId = item.zoneName ? await resolveZoneId(item.zoneName) : undefined;
      const nodeId = item.nodeName ? await resolveNodeId(item.nodeName, zoneId) : undefined;

      if (!dryRun) {
        await provisioningService.importLegacyAccess(item.contractId, {
          nodeId,
          username: item.username,
          serviceAlias: item.serviceAlias,
          ipAddress: item.ipAddress,
          connectionStatus: item.connectionStatus,
        });
      }
    }

    const zonesReport = dryRun ? plannedNewZoneNames.size : zonesCreated;
    const nodesReport = dryRun ? plannedNewNodeNames.size : nodesCreated;
    console.log(`Zonas ${dryRun ? 'que se crearían' : 'creadas'}: ${zonesReport}.`);
    console.log(`Nodos ${dryRun ? 'que se crearían' : 'creados'}: ${nodesReport}.`);

    if (exceptions.length > 0) {
      console.log('\nExcepciones (no importadas):');
      for (const exception of exceptions) {
        console.log(`  Fila ${exception.rowNumber} (doc "${exception.docNumber}"): ${exception.reason}`);
      }
      if (exceptionsOut) {
        writeExceptionsCsv(exceptionsOut, exceptions);
        console.log(`\nReporte de excepciones escrito en ${path.resolve(exceptionsOut)}`);
      }
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error ejecutando el import de red heredada:', error.message);
    process.exit(1);
  });
