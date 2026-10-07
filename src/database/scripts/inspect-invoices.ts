import * as dotenv from 'dotenv';
dotenv.config();

import { AppDataSource } from '../../config/database.config';

async function main() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const invoices = await AppDataSource.query(`SELECT * FROM "pos"."invoices" LIMIT 10;`);
  console.log('--- TODAS LAS FACTURAS EN "pos"."invoices" ---');
  console.table(invoices.map((i: any) => ({
    id: i.id,
    status: i.status,
    ncf_number: i.ncf_number,
    ncf_type: i.ncf_type,
    dgii_status: i.dgii_status,
    dgii_track_id: i.dgii_track_id,
    grand_total: i.grand_total,
    security_code: i.security_code,
    has_qr: !!i.qr_code_content,
    sale_id: i.sale_id,
    client_id: i.client_id,
  })));

  const runs = await AppDataSource.query(`SELECT * FROM "public"."dgii_certification_runs" ORDER BY executed_at DESC LIMIT 5;`);
  console.log('\n--- CASOS RECIENTES EN "dgii_certification_runs" ---');
  console.table(runs.map((r: any) => ({
    id: r.id,
    caso_numero: r.caso_numero,
    nombre_caso: r.nombre_caso,
    tipo_ecf: r.tipo_ecf,
    e_ncf: r.e_ncf,
    status: r.status,
    track_id: r.track_id,
    security_code: r.security_code,
    monto_total: r.monto_total,
  })));

  await AppDataSource.destroy();
}

main().catch(console.error);
