import * as dotenv from 'dotenv';
dotenv.config();
import * as jwt from 'jsonwebtoken';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const token = jwt.sign(
    { sub: '186753cf-6c0c-4c4d-baa4-9a92db5ffec7', username: 'admin', roles: ['ADMIN'] },
    process.env.JWT_SECRET || 'dev_jwt_secret_key_sumtech_super_secure_2026',
  );
  const client = axios.create({
    baseURL: 'http://localhost:4000/api/v1',
    headers: {
      Authorization: 'Bearer ' + token,
      'X-Tenant-Slug': 'sumtech',
    },
  });

  // Buscar cliente RNC
  const clientsRes = await client.get('/clients?limit=10');
  const clients = clientsRes.data?.data || clientsRes.data;
  const clientRnc = clients.find((c: any) => c.docType === 'RNC') || clients[0];
  console.log('Cliente seleccionado:', clientRnc.name, clientRnc.docNumber);

  // Emitir factura directa e-CF E31
  console.log('Emitiendo factura directa e-CF...');
  const emitRes = await client.post('/invoicing/emit-direct', {
    clientId: clientRnc.id,
    ncfType: 'E31',
    concept: 'Enlace Dedicado de Fibra Óptica Empresarial 300 Mbps',
    subtotal: 10000,
    isTaxExempt: false,
    paymentMethod: 'TRANSFER',
  });

  const emitted = emitRes.data;
  console.log('Factura emitida exitosamente:');
  console.log('ID:', emitted.id);
  console.log('e-NCF:', emitted.ncfNumber);
  console.log('Tipo:', emitted.ncfType);
  console.log('Estado:', emitted.status);
  console.log('DGII Status:', emitted.dgiiStatus);
  console.log('TrackID:', emitted.dgiiTrackId);
  console.log('Security Code:', emitted.securityCode);
  console.log('Total:', emitted.grandTotal);
  console.log('QR Code URL:', emitted.qrCodeContent);

  // Descargar su PDF
  const pdfRes = await client.get(`/invoicing/${emitted.id}/pdf`, { responseType: 'arraybuffer' });
  const outDir = path.resolve(__dirname, 'output');
  fs.writeFileSync(path.join(outDir, 'factura_directa_E31.pdf'), Buffer.from(pdfRes.data));
  console.log(`PDF Factura Directa E31 guardado (${pdfRes.data.length} bytes) en output/factura_directa_E31.pdf`);
}

main().catch((e) => {
  if (e.response) {
    console.error('STATUS:', e.response.status);
    console.error('DATA:', JSON.stringify(e.response.data, null, 2));
  } else {
    console.error('Error:', e.message);
  }
});
