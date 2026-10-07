import * as dotenv from 'dotenv';
dotenv.config();

import * as jwt from 'jsonwebtoken';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from '../../config/database.config';

async function main() {
  await AppDataSource.initialize();

  const adminUser = {
    id: '186753cf-6c0c-4c4d-baa4-9a92db5ffec7',
    username: 'admin',
    email: 'admin@sumtech.do',
  };

  const jwtSecret = process.env.JWT_SECRET || 'dev_jwt_secret_key_sumtech_super_secure_2026';
  const token = jwt.sign(
    {
      sub: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      roles: ['ADMIN'],
    },
    jwtSecret,
    { expiresIn: '1h' },
  );

  const client = axios.create({
    baseURL: 'http://localhost:4000/api/v1',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  // Factura E32 de /dashboard/facturas
  const e32InvoiceId = '1dee133e-b13d-4754-997b-1c7e5d816d78';
  const invReceiptRes = await client.get(`/invoicing/${e32InvoiceId}/receipt`);
  console.log('\n======================================================');
  console.log('--- METADATOS FACTURA E32 /dashboard/facturas ---');
  console.log('======================================================');
  console.log(JSON.stringify(invReceiptRes.data, null, 2));

  // PDF de la factura E32 de /dashboard/facturas
  const invPdfRes = await client.get(`/invoicing/${e32InvoiceId}/pdf`, { responseType: 'arraybuffer' });
  const outDir = path.resolve(__dirname, 'output');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(path.join(outDir, 'factura_E32_dashboard.pdf'), Buffer.from(invPdfRes.data));

  // Factura E32 de /dashboard/dgii/certificacion pestaña 3
  const simEncf = 'E320000000166';
  const simPdfRes = await client.get(`/invoicing/dgii/certification/pdf/${simEncf}?format=a4&offset=0`, { responseType: 'arraybuffer' });
  fs.writeFileSync(path.join(outDir, 'simulacion_E32_certificacion.pdf'), Buffer.from(simPdfRes.data));

  console.log(`\nPDF Factura E32 guardado: ${invPdfRes.data.length} bytes`);
  console.log(`PDF Simulación E32 guardado: ${simPdfRes.data.length} bytes`);

  // Factura E31 (Crédito Fiscal) de /dashboard/facturas
  const e31InvoiceId = '1f681d68-2862-4ec7-80da-a64c2831b5c9';
  const e31ReceiptRes = await client.get(`/invoicing/${e31InvoiceId}/receipt`);
  console.log('\n======================================================');
  console.log('--- METADATOS FACTURA E31 /dashboard/facturas ---');
  console.log('======================================================');
  console.log(JSON.stringify(e31ReceiptRes.data, null, 2));

  const e31PdfRes = await client.get(`/invoicing/${e31InvoiceId}/pdf`, { responseType: 'arraybuffer' });
  fs.writeFileSync(path.join(outDir, 'factura_E31_dashboard.pdf'), Buffer.from(e31PdfRes.data));

  // Simulación E31 de certificación
  const simE31Encf = 'E310000000001';
  const simE31PdfRes = await client.get(`/invoicing/dgii/certification/pdf/${simE31Encf}?format=a4&offset=0`, { responseType: 'arraybuffer' });
  fs.writeFileSync(path.join(outDir, 'simulacion_E31_certificacion.pdf'), Buffer.from(simE31PdfRes.data));

  console.log(`\nPDF Factura E31 guardado: ${e31PdfRes.data.length} bytes`);
  console.log(`PDF Simulación E31 guardado: ${simE31PdfRes.data.length} bytes`);

  await AppDataSource.destroy();
}

main().catch(console.error);
