import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { DataSource } from 'typeorm';

const ds = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5431', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: 'sumtech_erp',
});

async function main() {
  await ds.initialize();
  await ds.query(`
    INSERT INTO pos.ecf_sequences (ncf_type, serie, current_sequence, start_sequence, end_sequence, authorization_number, expiry_date, alert_remaining, is_active)
    VALUES ('E31', 'E', 3, 1, 500000, '6005450276', '31-12-2028', 50, true)
    ON CONFLICT (ncf_type) DO UPDATE SET current_sequence = GREATEST(pos.ecf_sequences.current_sequence, 3);
  `);
  const seqs = await ds.query(`SELECT * FROM pos.ecf_sequences`);
  console.log('UPDATED SEQS:', seqs);
  await ds.destroy();
}

main().catch(console.error);
