import * as dotenv from 'dotenv';
dotenv.config();

import { PlatformDataSource } from '../config/platform-database.config';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

export interface TenantMigrationTarget {
  id: string;
  name: string;
  slug: string;
  dbName: string;
  status: string;
}

export interface MigrateAllTenantsOptions {
  tenantSlug?: string;
  dryRun?: boolean;
}

export interface MigrationSummary {
  totalTenants: number;
  successfulTenants: number;
  failedTenants: { slug: string; dbName: string; error: string }[];
  totalMigrationsApplied: number;
}

/**
 * Aplica migraciones pendientes a todas las bases de datos de tenants activos y en trial
 * registradas en la DB de plataforma (sumtech_platform).
 *
 * Cada base de datos de tenant es actualizada de forma secuencial y aislada.
 * La base de datos de plataforma NUNCA es modificada por este script.
 */
export async function migrateAllTenants(
  options: MigrateAllTenantsOptions = {},
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    totalTenants: 0,
    successfulTenants: 0,
    failedTenants: [],
    totalMigrationsApplied: 0,
  };

  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.warn(`⚠️  Directorio de migraciones no encontrado: ${migrationsDir}`);
    return summary;
  }

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  console.log(`📦 Se encontraron ${migrationFiles.length} archivo(s) de migración .sql en el repositorio.`);

  try {
    if (!PlatformDataSource.isInitialized) {
      await PlatformDataSource.initialize();
    }

    let query = `
      SELECT "id", "name", "slug", "db_name" AS "dbName", "status"
      FROM "platform"."tenants"
      WHERE "status" IN ('ACTIVE', 'TRIAL')
    `;
    const params: any[] = [];

    if (options.tenantSlug) {
      query += ` AND LOWER("slug") = LOWER($1)`;
      params.push(options.tenantSlug);
    }

    query += ` ORDER BY "created_at" ASC`;

    const tenants: TenantMigrationTarget[] = await PlatformDataSource.query(query, params);
    summary.totalTenants = tenants.length;

    if (tenants.length === 0) {
      console.log('ℹ️  No se encontraron tenants activos o en trial para migrar.');
      return summary;
    }

    console.log(`🚀 Iniciando migración fan-out para ${tenants.length} tenant(s)...`);

    for (const tenant of tenants) {
      console.log(`\n──────────────────────────────────────────────────────────────────`);
      console.log(`🏢 [Tenant: ${tenant.slug}] Empresa: "${tenant.name}" | DB: "${tenant.dbName}" (Estado: ${tenant.status})`);

      let tenantDs: DataSource | null = null;
      try {
        tenantDs = new DataSource({
          type: 'postgres',
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432', 10),
          username: process.env.DB_USERNAME || 'postgres',
          password: process.env.DB_PASSWORD || 'postgres',
          database: tenant.dbName,
          synchronize: false,
          logging: false,
        });

        await tenantDs.initialize();
        await tenantDs.query(`SET client_encoding = 'UTF8';`);

        // Asegurar esquemas básicos del modelo de datos de Sumtech
        await tenantDs.query(`
          CREATE SCHEMA IF NOT EXISTS "sec";
          CREATE SCHEMA IF NOT EXISTS "com";
          CREATE SCHEMA IF NOT EXISTS "pos";
          CREATE SCHEMA IF NOT EXISTS "inv";
          CREATE SCHEMA IF NOT EXISTS "tickets";
          CREATE SCHEMA IF NOT EXISTS "crm";
          CREATE SCHEMA IF NOT EXISTS "geo";
          CREATE SCHEMA IF NOT EXISTS "net";
        `);

        // Asegurar tabla de control de versiones de esquema
        await tenantDs.query(`
          CREATE TABLE IF NOT EXISTS "sec"."schema_migrations" (
            "filename" VARCHAR(255) PRIMARY KEY,
            "applied_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
          );
        `);

        // Consultar migraciones aplicadas
        const appliedRows = await tenantDs.query(`SELECT "filename" FROM "sec"."schema_migrations"`);
        const applied = new Set<string>(appliedRows.map((r: any) => r.filename));

        // Si la base de datos ya tiene su estructura completa desde el registro (vía synchronize()),
        // pero schema_migrations está vacía, registrar las migraciones históricas como línea base
        // para que cada tenant tenga su estructura completa y solo reciba evoluciones futuras.
        if (applied.size === 0) {
          const userTableCheck = await tenantDs.query(`
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'sec' AND table_name = 'users'
          `);
          if (userTableCheck.length > 0) {
            console.log(`   ⚙️  Estructura base completa detectada: estableciendo línea base de migraciones...`);
            for (const file of migrationFiles) {
              await tenantDs.query(
                `INSERT INTO "sec"."schema_migrations" ("filename") VALUES ($1) ON CONFLICT ("filename") DO NOTHING`,
                [file],
              );
              applied.add(file);
            }
            console.log(`   ✅ Línea base establecida (${migrationFiles.length} migraciones sincronizadas).`);
          }
        }

        const pending = migrationFiles.filter((f) => !applied.has(f));

        if (pending.length === 0) {
          console.log(`   ✅ DB al día (${applied.size}/${migrationFiles.length} migraciones aplicadas). Nada pendiente.`);
        } else {
          console.log(`   ⚡ ${pending.length} migración(es) pendiente(s) por aplicar.`);

          if (options.dryRun) {
            console.log(`   [DRY-RUN] Se habrían aplicado: ${pending.join(', ')}`);
          } else {
            for (const file of pending) {
              const filePath = path.join(migrationsDir, file);
              let sql = fs.readFileSync(filePath, 'utf8');
              sql = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

              console.log(`   ➡️  Aplicando ${file}...`);
              // Ejecución de la sentencia DDL/DML
              await tenantDs.query(sql);
              await tenantDs.query(
                `INSERT INTO "sec"."schema_migrations" ("filename") VALUES ($1) ON CONFLICT ("filename") DO NOTHING`,
                [file],
              );
              console.log(`   ✔️  ${file} aplicado con éxito.`);
              summary.totalMigrationsApplied++;
            }
          }
        }

        summary.successfulTenants++;
      } catch (err: any) {
        console.error(`   ❌ Error migrando DB "${tenant.dbName}" del tenant "${tenant.slug}":`, err.message);
        summary.failedTenants.push({
          slug: tenant.slug,
          dbName: tenant.dbName,
          error: err.message,
        });
      } finally {
        if (tenantDs?.isInitialized) {
          await tenantDs.destroy();
        }
      }
    }

    console.log(`\n==================================================================`);
    console.log(`📊 RESUMEN DE MIGRACIÓN FAN-OUT:`);
    console.log(`   • Total tenants evaluados: ${summary.totalTenants}`);
    console.log(`   • Tenants exitosos:       ${summary.successfulTenants}`);
    console.log(`   • Tenants con fallo:      ${summary.failedTenants.length}`);
    console.log(`   • Total migraciones:      ${summary.totalMigrationsApplied}`);
    console.log(`==================================================================\n`);

    return summary;
  } finally {
    if (PlatformDataSource.isInitialized) {
      await PlatformDataSource.destroy();
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const tenantArg = args.find((a) => a.startsWith('--tenant='));
  const tenantSlug = tenantArg ? tenantArg.split('=')[1] : undefined;
  const dryRun = args.includes('--dry-run');

  migrateAllTenants({ tenantSlug, dryRun })
    .then((summary) => {
      if (summary.failedTenants.length > 0) {
        console.error(`💥 La migración fan-out concluyó con ${summary.failedTenants.length} fallo(s).`);
        process.exit(1);
      } else {
        console.log('✨ Migración fan-out finalizada exitosamente.');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('💥 Error crítico ejecutando migración fan-out:', err);
      process.exit(1);
    });
}
