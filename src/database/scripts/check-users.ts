import * as dotenv from 'dotenv';
dotenv.config();

import { AppDataSource } from '../../config/database.config';

async function main() {
  await AppDataSource.initialize();
  const users = await AppDataSource.query(`SELECT id, username, email FROM "sec"."users" LIMIT 5;`);
  console.log('USERS:', users);
  const roles = await AppDataSource.query(`SELECT * FROM "sec"."roles" LIMIT 5;`);
  console.log('ROLES:', roles);
  await AppDataSource.destroy();
}

main().catch(console.error);
