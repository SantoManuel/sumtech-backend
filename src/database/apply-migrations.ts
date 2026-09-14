import * as dotenv from 'dotenv';
dotenv.config();

import { AppDataSource } from '../config/database.config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Ejecuta cada archivo .sql de migrations/ EXACTAMENTE UNA VEZ, registrando los ya
 * aplicados en sec.schema_migrations. Antes esta función volvía a ejecutar todas
 * las migraciones en cada corrida; para archivos que solo crean tablas eso era
 * inofensivo, pero un backfill de datos (como el de 003) se corrompe si se repite
 * sobre filas que el sistema ya modificó desde la primera aplicación.
 */
export async function applyMigrations() {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    console.log('✅ Base de datos conectada.');

    await AppDataSource.query(`
      CREATE TABLE IF NOT EXISTS "sec"."schema_migrations" (
        "filename" VARCHAR(255) PRIMARY KEY,
        "applied_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const appliedRows = await AppDataSource.query(`SELECT "filename" FROM "sec"."schema_migrations"`);
    const applied = new Set<string>(appliedRows.map((r: any) => r.filename));

    const pending = files.filter((f) => !applied.has(f));
    console.log(`⚡ ${files.length} archivo(s) de migración encontrados, ${pending.length} pendiente(s) de aplicar.`);

    for (const file of pending) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`➡️  Ejecutando migración: ${file}...`);
      await AppDataSource.query(sql);
      await AppDataSource.query(`INSERT INTO "sec"."schema_migrations" ("filename") VALUES ($1)`, [file]);
      console.log(`✅ Migración ${file} aplicada.`);
    }

    if (pending.length === 0) {
      console.log('ℹ️  No había migraciones pendientes; nada que ejecutar.');
    }

    // Verificar tablas en esquema tickets
    const tables = await AppDataSource.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'tickets'
    `);
    console.log('📋 Tablas en esquema tickets:', tables.map((t: any) => t.table_name));

  } catch (error) {
    console.error('❌ Error aplicando migraciones:', error);
    process.exit(1);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

if (require.main === module) {
  applyMigrations();
}
