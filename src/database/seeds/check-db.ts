import { AppDataSource } from '../../config/database.config';

async function checkDatabase() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  console.log('🔍 Consultando tablas existentes en todos los esquemas de PostgreSQL...');
  
  const tables = await AppDataSource.query(`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema IN ('sec', 'com', 'pos', 'inv', 'tickets', 'crm', 'public')
    ORDER BY table_schema, table_name;
  `);

  console.log('\n📋 LISTADO DE TABLAS POR ESQUEMA:');
  console.table(tables);

  console.log('\n📊 CONTEO DE REGISTROS POR TABLA:');
  for (const t of tables) {
    const countResult = await AppDataSource.query(`SELECT COUNT(*) as count FROM "${t.table_schema}"."${t.table_name}"`);
    console.log(`- Esquema: [${t.table_schema.padEnd(8)}] | Tabla: [${t.table_name.padEnd(20)}] -> ${countResult[0].count} registros`);
  }

  await AppDataSource.destroy();
}

checkDatabase().catch(console.error);
