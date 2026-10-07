import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import { PlatformDataSource } from '../../config/platform-database.config';
import { TenantEntity } from '../../modules/platform/entities/tenant.entity';
import { SupportAccessSessionEntity } from '../../modules/platform/entities/support-access-session.entity';
import { SaasSubscriptionEntity } from '../../modules/platform/entities/saas-subscription.entity';
import { TenantTunnelAllocationEntity } from '../../modules/platform/entities/tenant-tunnel-allocation.entity';
import { PlatformAuditLogEntity } from '../../modules/platform/entities/platform-audit-log.entity';

/**
 * Script de saneamiento y depuración de inquilinos de prueba residuales.
 *
 * Elimina de forma transaccional los inquilinos creados durante pruebas automáticas
 * y tests de aprovisionamiento, preservando estrictamente los tenants oficiales:
 * - 'sumtech' (Sumtech Ramirez / ERP principal)
 * - 'ispazua' (ISP Azua Telecom, S.R.L.)
 * - 'demo' (Demo Telecomunicaciones)
 *
 * Uso:
 *   npx ts-node src/database/scripts/clean-test-tenants.ts             # Modo Dry-Run (solo inspección)
 *   npx ts-node src/database/scripts/clean-test-tenants.ts --force     # Aplicar eliminación transaccional
 *   npx ts-node src/database/scripts/clean-test-tenants.ts --force --drop-databases # También eliminar DBs Postgres
 */

const PROTECTED_SLUGS = new Set(['sumtech', 'ispazua', 'demo']);
const TARGET_TEST_SLUGS = [
  'tenant_test_a',
  'tenant_test_b',
  'cablesur-prov-test',
  'netplus-prov-test',
  'fase4-test',
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isForce = args.includes('--force');
  const dropDatabases = args.includes('--drop-databases');

  console.log('🧹 ==============================================================================');
  console.log('🧹 SANEAMIENTO DE TENANTS DE PRUEBA EN PLATAFORMA SAAS');
  console.log('🧹 ==============================================================================');
  console.log(`📋 Modo de Ejecución: ${isForce ? '⚡ FORZADO (APLICAR CAMBIOS)' : '🔍 DRY-RUN (SOLO LECTURA)'}`);
  console.log(`🗑️  Eliminación de DBs Postgres: ${dropDatabases ? 'SÍ' : 'NO'}\n`);

  if (!PlatformDataSource.isInitialized) {
    await PlatformDataSource.initialize();
  }

  const tenantRepo = PlatformDataSource.getRepository(TenantEntity);
  const supportRepo = PlatformDataSource.getRepository(SupportAccessSessionEntity);
  const subRepo = PlatformDataSource.getRepository(SaasSubscriptionEntity);
  const tunnelRepo = PlatformDataSource.getRepository(TenantTunnelAllocationEntity);
  const auditRepo = PlatformDataSource.getRepository(PlatformAuditLogEntity);

  // 1. Localizar tenants que coincidan con la lista de pruebas
  const allTenants = await tenantRepo.find();
  const testTenants = allTenants.filter((t) => {
    if (PROTECTED_SLUGS.has(t.slug.toLowerCase())) {
      return false; // Absolutamente protegido
    }
    return TARGET_TEST_SLUGS.includes(t.slug.toLowerCase());
  });

  if (testTenants.length === 0) {
    console.log('✅ No se encontraron inquilinos de prueba residuales para depurar.');
    console.log(`ℹ️  Tenants oficiales preservados: ${allTenants.map((t) => t.slug).join(', ')}`);
    await PlatformDataSource.destroy();
    return;
  }

  console.log(`🔎 Se identificaron ${testTenants.length} tenants de prueba para depuración:\n`);

  const auditSummary: any[] = [];

  for (const tenant of testTenants) {
    const supportSessionsCount = await supportRepo.count({ where: { tenantId: tenant.id } });
    const subscriptionsCount = await subRepo.count({ where: { tenantId: tenant.id } });
    const tunnelsCount = await tunnelRepo.count({ where: { tenantId: tenant.id } });

    auditSummary.push({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      dbName: tenant.dbName,
      status: tenant.status,
      sesionesSoporte: supportSessionsCount,
      suscripciones: subscriptionsCount,
      túneles: tunnelsCount,
    });
  }

  console.table(auditSummary);

  if (!isForce) {
    console.log('\n🔒 MODO DRY-RUN: Ningún registro ha sido alterado ni eliminado.');
    console.log('💡 Para aplicar la depuración real, ejecuta:');
    console.log('   npm run platform:clean-tenants:force\n');
    await PlatformDataSource.destroy();
    return;
  }

  console.log('\n⚡ Iniciando eliminación transaccional...');

  const queryRunner = PlatformDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    for (const tenant of testTenants) {
      console.log(`⏳ Depurando dependencias del tenant [${tenant.slug}] (${tenant.id})...`);

      // Eliminar dependencias en orden
      const deletedSessions = await queryRunner.manager.delete(SupportAccessSessionEntity, { tenantId: tenant.id });
      const deletedTunnels = await queryRunner.manager.delete(TenantTunnelAllocationEntity, { tenantId: tenant.id });
      const deletedSubs = await queryRunner.manager.delete(SaasSubscriptionEntity, { tenantId: tenant.id });
      const deletedTenant = await queryRunner.manager.delete(TenantEntity, { id: tenant.id });

      console.log(
        `   ↳ Sesiones soporte eliminadas: ${deletedSessions.affected || 0} | Túneles: ${deletedTunnels.affected || 0} | Suscripciones: ${deletedSubs.affected || 0} | Tenant: ${deletedTenant.affected || 0}`,
      );
    }

    // Registrar evento de auditoría en la plataforma
    const auditLog = auditRepo.create({
      action: 'PLATFORM_TEST_TENANTS_CLEANED',
      entity: 'TenantEntity',
      metadata: {
        deletedSlugs: testTenants.map((t) => t.slug),
        deletedTenantsCount: testTenants.length,
        executedBy: 'SCRIPT_CLI_CLEAN_TEST_TENANTS',
        executedAt: new Date().toISOString(),
      },
      ipAddress: '127.0.0.1',
    });
    await queryRunner.manager.save(auditLog);

    await queryRunner.commitTransaction();
    console.log('\n✅ Transacción confirmada en sumtech_platform con éxito.');
  } catch (error) {
    console.error('❌ Error durante la eliminación transaccional. Aplicando ROLLBACK...', error);
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }

  // 3. Opcional: Eliminar bases de datos PostgreSQL si se especificó --drop-databases
  if (dropDatabases) {
    console.log('\n🐘 Verificando bases de datos PostgreSQL dedicadas para eliminar...');
    const adminDs = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_ADMIN_USERNAME || process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_ADMIN_PASSWORD || process.env.DB_PASSWORD || 'postgres',
      database: 'postgres', // Conectar a DB administrativa para poder hacer DROP DATABASE
      synchronize: false,
    });

    try {
      await adminDs.initialize();
      for (const tenant of testTenants) {
        if (!tenant.dbName || tenant.dbName === 'sumtech_erp' || tenant.dbName === 'sumtech_platform') {
          continue; // Protección estricta de DBs críticas
        }

        const dbExists = await adminDs.query(
          `SELECT 1 FROM pg_database WHERE datname = $1`,
          [tenant.dbName],
        );

        if (dbExists.length > 0) {
          console.log(`🗑️  Eliminando base de datos Postgres: "${tenant.dbName}"...`);
          // Cerrar conexiones activas antes de hacer DROP
          await adminDs.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
            [tenant.dbName],
          );
          await adminDs.query(`DROP DATABASE IF EXISTS "${tenant.dbName}"`);
          console.log(`   ↳ Base de datos "${tenant.dbName}" eliminada con éxito.`);
        } else {
          console.log(`ℹ️  Base de datos "${tenant.dbName}" no existía en el servidor Postgres.`);
        }
      }
      await adminDs.destroy();
    } catch (dbErr) {
      console.warn('⚠️  Aviso: No se pudieron eliminar una o más bases de datos Postgres:', dbErr);
    }
  }

  console.log('\n🎉 Saneamiento de tenants completado con éxito.');
  await PlatformDataSource.destroy();
}

main().catch((err) => {
  console.error('❌ Error fatal ejecutando saneamiento de tenants:', err);
  process.exit(1);
});
