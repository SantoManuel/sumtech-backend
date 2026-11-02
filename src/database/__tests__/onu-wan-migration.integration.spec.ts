import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

// Opt-in, isolated PostgreSQL database. All DDL/data are rolled back; never use a tenant DB.
const url = process.env.WAN_MIGRATION_TEST_URL;
const suite = url ? describe : describe.skip;
suite('106 ONU WAN migration (PostgreSQL integration)', () => {
  let client: Client;
  const onuId = '00000000-0000-4000-8000-000000000001';
  const contractId = '00000000-0000-4000-8000-000000000002';
  const migration = readFileSync(join(__dirname, '../migrations/106_onu_wan_provisioning.sql'), 'utf8');

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/sumtech_wan_test') {
      throw new Error('WAN_MIGRATION_TEST_URL must name the local, disposable sumtech_wan_test database.');
    }
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query('BEGIN');
    // Fail rather than altering an existing schema, even inside a test-named database.
    await client.query(`CREATE SCHEMA net;
      CREATE TABLE net.onus(id uuid PRIMARY KEY, contract_id uuid);
      CREATE TABLE net.onu_service_config(onu_id uuid UNIQUE, management_method text, tr069_network_id uuid, cpe_config_status text);
      CREATE TABLE net.network_access(contract_id uuid, username text, pppoe_password_enc text);`);
    await client.query('INSERT INTO net.onus VALUES($1,$2)', [onuId, contractId]);
    await client.query("INSERT INTO net.onu_service_config VALUES($1,'TR069',$2,'PENDING')", [onuId, contractId]);
    await client.query("INSERT INTO net.network_access VALUES($1,'old-user','encrypted-before')", [contractId]);
    await client.query(migration);
  });
  afterAll(async () => { if (client) { await client.query('ROLLBACK'); await client.end(); } });

  it('backfills a desired method without fabricating hardware confirmation', async () => {
    const row = (await client.query('SELECT * FROM net.onu_service_config')).rows[0];
    expect(row).toMatchObject({ wan_provisioning_method: 'TR069', wan_applied_method: null, wan_apply_status: 'UNKNOWN', wan_desired_version: 0 });
    expect((await client.query('SELECT * FROM net.onu_wan_operations')).rows).toHaveLength(0);
  });

  it('can run twice without overwriting an explicitly selected method', async () => {
    await client.query("UPDATE net.onu_service_config SET wan_provisioning_method='OMCI', wan_apply_status='APPLIED',wan_desired_version=3");
    await client.query(migration);
    expect((await client.query('SELECT wan_provisioning_method FROM net.onu_service_config')).rows[0].wan_provisioning_method).toBe('OMCI');
  });

  it('invalidates pending operations and advances desired version when credentials change', async () => {
    await client.query("INSERT INTO net.onu_wan_operations(onu_id,version,method,status,request_fingerprint) VALUES($1,3,'OMCI','QUEUED','fingerprint')", [onuId]);
    await client.query("UPDATE net.network_access SET username='new-user',pppoe_password_enc='encrypted-after'");
    expect((await client.query('SELECT * FROM net.onu_service_config')).rows[0]).toMatchObject({ wan_desired_version: 4, wan_apply_status: 'PENDING', cpe_config_status: 'PENDING' });
    expect((await client.query('SELECT status FROM net.onu_wan_operations')).rows[0].status).toBe('ERROR');
  });

  it('does not invalidate a WAN when credentials did not change', async () => {
    await client.query('UPDATE net.network_access SET username=username,pppoe_password_enc=pppoe_password_enc');
    expect((await client.query('SELECT wan_desired_version FROM net.onu_service_config')).rows[0].wan_desired_version).toBe(4);
  });
});
