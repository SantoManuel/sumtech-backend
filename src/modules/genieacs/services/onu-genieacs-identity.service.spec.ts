import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { OnuGenieacsIdentityService } from './onu-genieacs-identity.service';
import { normalizeDeviceMac } from '../utils/device-mac';
import { GenieAcsClient } from '../genieacs-client';

describe('OnuGenieacsIdentityService', () => {
  const mac = '2CB2726623EB';
  const deviceId = '2CB272-F660-ZTEGC687ABB0234';
  let service: OnuGenieacsIdentityService;
  let client: any;
  let db: any;
  let runner: any;
  let onu: any;
  let doc: any;
  let platform: any;
  let connections: any;

  beforeEach(() => {
    onu = { id: 'onu-1', serial_number: 'ZTEGC288E7C5', management_mac: mac, management_mac_source: 'OLT_IPHOST_2' };
    doc = { _id: deviceId, _deviceId: { _SerialNumber: 'ZTEGC687ABB0234' }, _tags: [] };
    let node = doc;
    for (const key of 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1'.split('.')) {
      node[key] = {}; node = node[key];
    }
    node.MACAddress = { _value: '2c:b2:72:66:23:eb' };
    client = { findDeviceBySerial: jest.fn().mockResolvedValue(null), findDeviceByExactMac: jest.fn().mockResolvedValue(deviceId),
      getDeviceDocument: jest.fn().mockImplementation(async () => doc), setDeviceTag: jest.fn() };
    db = { query: jest.fn(async (sql: string) => sql.startsWith('SELECT *') ? [onu] : sql.startsWith('WITH updated') ? [{ id: onu.id }] : []) };
    runner = { connect: jest.fn(), startTransaction: jest.fn(), commitTransaction: jest.fn(), rollbackTransaction: jest.fn(), release: jest.fn(),
      isTransactionActive: true, query: jest.fn().mockResolvedValue([]) };
    platform = { createQueryRunner: () => runner, getRepository: () => ({ find: jest.fn().mockResolvedValue([{ id: 'tenant-1' }]) }) };
    connections = { getDataSourceForTenant: jest.fn() };
    service = new OnuGenieacsIdentityService(client, { getDataSource: () => db, getSlug: () => 'sumtech', getTenantId: () => 'tenant-1' } as any,
      platform, connections, { setIdentityVerifier: jest.fn() } as any);
  });

  it('links the real ZTE mismatch by exact management MAC without replacing GPON serial', async () => {
    await expect(service.resolveOnu('onu-1')).resolves.toEqual({ deviceId, method: 'MAC', managementMac: mac, tr069SerialNumber: 'ZTEGC687ABB0234' });
    expect(client.findDeviceByExactMac).toHaveBeenCalledWith(mac);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('tr069_serial_number=$3'), ['onu-1', deviceId, 'ZTEGC687ABB0234', 'MAC', 'ZTEGC288E7C5', mac, 'OLT_IPHOST_2']);
    expect(onu.serial_number).toBe('ZTEGC288E7C5');
    expect(runner.commitTransaction).toHaveBeenCalled();
  });
  it('keeps exact serial linking when MAC is unavailable', async () => {
    onu.management_mac = null;
    client.findDeviceBySerial.mockResolvedValue(deviceId);
    doc._deviceId._SerialNumber = onu.serial_number;
    expect((await service.resolveOnu('onu-1'))?.method).toBe('SERIAL');
    expect(client.findDeviceByExactMac).not.toHaveBeenCalled();
  });
  it('never uses a traffic MAC with unknown provenance', async () => {
    onu.management_mac_source = 'LEARNED_TRAFFIC';
    expect(await service.resolveOnu('onu-1')).toBeNull();
    expect(client.findDeviceByExactMac).not.toHaveBeenCalled();
  });
  it('distinguishes not found from transport failure', async () => {
    client.findDeviceByExactMac.mockResolvedValue(null);
    expect(await service.resolveOnu('onu-1')).toBeNull();
    client.findDeviceBySerial.mockRejectedValue(new Error('timeout'));
    await expect(service.resolveOnu('onu-1')).rejects.toThrow(ServiceUnavailableException);
    expect(runner.commitTransaction).not.toHaveBeenCalled();
  });
  it('blocks serial and MAC pointing at different devices', async () => {
    client.findDeviceBySerial.mockResolvedValue('other-device');
    await expect(service.resolveOnu('onu-1')).rejects.toThrow(ConflictException);
    expect(client.setDeviceTag).not.toHaveBeenCalled();
  });
  it('blocks multiple exact MAC matches', async () => {
    client.findDeviceByExactMac.mockRejectedValue(new Error('La identidad del CPE es ambigua en GenieACS.'));
    await expect(service.resolveOnu('onu-1')).rejects.toThrow(ConflictException);
  });
  it('blocks a contradictory existing binding', async () => {
    onu.genieacs_device_id = 'different-device';
    await expect(service.resolveOnu('onu-1')).rejects.toThrow(ConflictException);
  });
  it('blocks a foreign tenant tag', async () => {
    doc._tags = ['TENANT:other'];
    await expect(service.resolveOnu('onu-1')).rejects.toThrow(ConflictException);
    expect(client.setDeviceTag).not.toHaveBeenCalled();
  });
  it('blocks an existing global owner even without GenieACS tags', async () => {
    runner.query.mockImplementation(async (sql: string) => sql.startsWith('SELECT *') ? [{ device_id: deviceId, tenant_id: 'other', onu_id: 'other' }] : []);
    await expect(service.resolveOnu('onu-1')).rejects.toThrow(ConflictException);
    expect(runner.rollbackTransaction).toHaveBeenCalled();
    expect(client.setDeviceTag).not.toHaveBeenCalled();
  });
  it('checks historical bindings in other tenant databases before a first claim', async () => {
    platform.getRepository = () => ({ find: async () => [{ id: 'tenant-1' }, { id: 'tenant-2' }] });
    connections.getDataSourceForTenant.mockResolvedValue({ query: async () => [{ id: 'other-onu' }] });
    await expect(service.resolveOnu('onu-1')).rejects.toThrow(ConflictException);
    expect(client.setDeviceTag).not.toHaveBeenCalled();
  });
  it('blocks a MAC that changed between search and document verification', async () => {
    doc.InternetGatewayDevice.WANDevice[1].WANConnectionDevice[1].WANIPConnection[1].MACAddress._value = '2c:b2:72:66:23:ec';
    await expect(service.resolveOnu('onu-1')).rejects.toThrow(ConflictException);
  });
  it('invalidates a previously stored MAC when host 2 no longer has one', async () => {
    await service.recordManagementMac('onu-1');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('management_mac_source'), ['onu-1', null]);
  });
  it('does not commit a binding when the ONU identity changes during verification', async () => {
    db.query.mockImplementation(async (sql: string) => sql.startsWith('SELECT *') ? [onu] : []);
    await expect(service.resolveOnu('onu-1')).rejects.toThrow(ConflictException);
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(runner.rollbackTransaction).toHaveBeenCalled();
  });
  it('checks identity again before writes to a linked device', async () => {
    db.query.mockImplementation(async (sql: string) => sql.startsWith('SELECT id,contract_id') ? [{ id: 'onu-1', contract_id: 'contract-1' }] : sql.startsWith('SELECT *') ? [onu] : sql.startsWith('WITH updated') ? [{ id: onu.id }] : []);
    await expect(service.verifyDeviceForWrite(deviceId, 'contract-1')).resolves.toBeUndefined();
    await expect(service.verifyDeviceForWrite(deviceId, 'other-contract')).rejects.toThrow(ConflictException);
  });
});

describe('management MAC normalization', () => {
  it.each(['2cb2.7266.23eb', '2c:b2:72:66:23:eb', '2C-B2-72-66-23-EB', '2CB2726623EB'])('normalizes %s', mac => {
    expect(normalizeDeviceMac(mac)).toBe('2CB2726623EB');
  });
  it.each(['0000.0000.0000', 'ff:ff:ff:ff:ff:ff', '01:00:5e:00:00:01', '2cb2726623', 'garbage2cb2726623eb'])('rejects %s', mac => {
    expect(normalizeDeviceMac(mac)).toBeUndefined();
  });
  it('matches the management MAC only on supported device MAC parameters', () => {
    expect(GenieAcsClient.documentHasExactMac({ Device: { Ethernet: { Interface: { 1: { MACAddress: { _value: '2cb2.7266.23eb' } } } } } }, '2CB2726623EB')).toBe(true);
  });
});
