import * as dotenv from 'dotenv';
dotenv.config();
import * as jwt from 'jsonwebtoken';
import axios from 'axios';

async function main() {
  const token = jwt.sign(
    { sub: '186753cf-6c0c-4c4d-baa4-9a92db5ffec7', username: 'admin', roles: ['ADMIN'] },
    process.env.JWT_SECRET || 'dev_jwt_secret_key_sumtech_super_secure_2026',
  );

  const client = axios.create({
    baseURL: 'http://localhost:4000/api/v1',
    headers: {
      Authorization: 'Bearer ' + token,
    },
  });

  try {
    const res = await client.get('/invoicing', {
      params: { page: 1, limit: 15 },
    });
    console.log('GET /invoicing SUCCESS:');
    console.log('Total items:', res.data.total);
    console.log('Items:', res.data.data.map((i: any) => ({
      id: i.id,
      ncf: i.ncfNumber,
      status: i.status,
      grandTotal: i.grandTotal,
      client: i.client?.name,
    })));
  } catch (err: any) {
    console.error('GET /invoicing FAILED:');
    console.error('Status:', err.response?.status);
    console.error('Data:', err.response?.data);
  }
}

main().catch(console.error);
