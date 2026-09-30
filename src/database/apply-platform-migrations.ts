import * as dotenv from 'dotenv';
dotenv.config();

import { PlatformDataSource } from '../config/platform-database.config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Igual que apply-migrations.ts pero contra la DB de plataforma
 * (sumtech_platform) en vez de la DB de un tenant. Bootstrap inicial vía
 * synchronize() en una DB vacía, luego cada .sql de platform-migrations/ se
 * aplica exactamente una vez (registrado en platform.schema_migrations).
 */
export async function applyPlatformMigrations() {
  try {
    if (!PlatformDataSource.isInitialized) {
      await PlatformDataSource.initialize();
    }
    await PlatformDataSource.query(`SET client_encoding = 'UTF8';`);

    console.log('📦 Verificando/creando esquema "platform"...');
    await PlatformDataSource.query(`CREATE SCHEMA IF NOT EXISTS "platform";`);

    await PlatformDataSource.query(`
      CREATE TABLE IF NOT EXISTS "platform"."schema_migrations" (
        "filename" VARCHAR(255) PRIMARY KEY,
        "applied_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    const baseTables = await PlatformDataSource.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'platform' AND table_name != 'schema_migrations';
    `);

    if (baseTables.length === 0) {
      console.log('⚙️  DB de plataforma vacía detectada: sincronizando estructura inicial de tablas...');
      await PlatformDataSource.synchronize();
      console.log('✅ Tablas base de plataforma inicializadas exitosamente.');
    }

    const migrationsDir = path.join(__dirname, 'platform-migrations');
    const files = fs.existsSync(migrationsDir)
      ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
      : [];

    const appliedRows = await PlatformDataSource.query(`SELECT "filename" FROM "platform"."schema_migrations"`);
    const applied = new Set<string>(appliedRows.map((r: any) => r.filename));

    const pending = files.filter((f) => !applied.has(f));
    console.log(`⚡ ${files.length} archivo(s) de migración de plataforma encontrados, ${pending.length} pendiente(s).`);

    for (const file of pending) {
      const filePath = path.join(migrationsDir, file);
      let sql = fs.readFileSync(filePath, 'utf8');
      sql = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

      console.log(`➡️  Ejecutando migración de plataforma: ${file}...`);
      await PlatformDataSource.query(sql);
      await PlatformDataSource.query(`INSERT INTO "platform"."schema_migrations" ("filename") VALUES ($1)`, [file]);
      console.log(`✅ Migración ${file} aplicada.`);
    }

    if (pending.length === 0) {
      console.log('ℹ️  No había migraciones de plataforma pendientes; nada que ejecutar.');
    }
  } catch (error) {
    console.error('❌ Error aplicando migraciones de plataforma:', error);
    process.exit(1);
  } finally {
    if (PlatformDataSource.isInitialized) {
      await PlatformDataSource.destroy();
    }
  }
}

if (require.main === module) {
  applyPlatformMigrations();
}
