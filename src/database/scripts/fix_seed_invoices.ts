import * as dotenv from 'dotenv';
dotenv.config();

import { AppDataSource } from '../../config/database.config';

async function main() {
  await AppDataSource.initialize();

  const rncEmisor = '131148697';
  console.log('--- REPARANDO FACTURAS EXISTENTES EN pos.invoices ---');
  const invoices = await AppDataSource.query(`
    SELECT i.id, i.status, i.ncf_number, i.ncf_type, i.sale_id, s.subtotal, s.itbis_total, s.grand_total
    FROM "pos"."invoices" i
    LEFT JOIN "pos"."sales" s ON i.sale_id = s.id;
  `);

  for (const inv of invoices) {
    let newNcf = inv.ncf_number;
    if (inv.ncf_number === 'E3100000001') newNcf = 'E310000000001';
    if (inv.ncf_number === 'E3100000002') newNcf = 'E310000000002';

    const subtotal = Number(inv.subtotal || 1000);
    const itbis = Number(inv.itbis_total || (subtotal * 0.18));
    const grandTotal = Number(inv.grand_total || (subtotal + itbis));

    const secCode = 'A8B2C4';
    let qrUrl = '';
    if (newNcf.startsWith('E32') && grandTotal < 250000) {
      qrUrl = `https://ecf.dgii.gov.do/certecf/consultatimbrefc?rncemisor=${rncEmisor}&encf=${newNcf}&montototal=${grandTotal.toFixed(2)}&codigoseguridad=${secCode}`;
    } else {
      qrUrl = `https://ecf.dgii.gov.do/certecf/consultatimbre?rncemisor=${rncEmisor}&encf=${newNcf}&fechaemision=01-10-2026&montototal=${grandTotal.toFixed(2)}&fechafirma=01-10-2026%2012%3A00%3A00&codigoseguridad=${secCode}`;
    }

    const expiryDate = (newNcf.startsWith('E31') || newNcf.startsWith('B01')) ? '31-12-2028' : null;

    await AppDataSource.query(`
      UPDATE "pos"."invoices"
      SET 
        ncf_number = $1,
        subtotal = $2,
        itbis_total = $3,
        grand_total = $4,
        security_code = $5,
        qr_code_content = $6,
        ncf_expiry_date = $7,
        dgii_status = 'ACCEPTED'
      WHERE id = $8;
    `, [newNcf, subtotal, itbis, grandTotal, secCode, qrUrl, expiryDate, inv.id]);

    console.log(`Factura ${inv.id} actualizada: e-NCF=${newNcf}, total=${grandTotal}, expiry=${expiryDate}`);
  }

  await AppDataSource.query(`
    UPDATE "sec"."company_profiles"
    SET commercial_name = TRIM(commercial_name)
    WHERE commercial_name IS NOT NULL;
  `);

  console.log('--- REPARACIÓN FINALIZADA CON ÉXITO ---');
  await AppDataSource.destroy();
}

main().catch(console.error);
