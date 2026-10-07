import * as dotenv from 'dotenv';
dotenv.config();
import * as jwt from 'jsonwebtoken';
import axios from 'axios';

async function check() {
  const token = jwt.sign(
    { sub: '186753cf-6c0c-4c4d-baa4-9a92db5ffec7', username: 'admin', roles: ['ADMIN'] },
    process.env.JWT_SECRET || 'dev_jwt_secret_key_sumtech_super_secure_2026',
  );
  const client = axios.create({
    baseURL: 'http://localhost:4000/api/v1',
    headers: { Authorization: 'Bearer ' + token },
  });

  const factRes = await client.get('/invoicing/1f681d68-2862-4ec7-80da-a64c2831b5c9/receipt');
  console.log('--- FACTURA DASHBOARD METADATA ---');
  const inv = factRes.data.invoice;
  console.log('ncfNumber:', inv.ncfNumber);
  console.log('ncfType:', inv.ncfType);
  console.log('securityCode:', inv.securityCode);
  console.log('digitalSignatureDate:', inv.digitalSignatureDate || inv.issuedAt);
  console.log('ncfExpiryDate:', inv.ncfExpiryDate);
  console.log('qrCodeUrl:', inv.qrCodeUrl);

  const simRes = await client.get('/invoicing/dgii/certification/pdf/E310000000001?format=a4&offset=0');
  console.log('--- SIMULACION DGII CERTIFICACION METADATA ---');
  console.log('PDF response status:', simRes.status);
}

check().catch(console.error);
