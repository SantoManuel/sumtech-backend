import { OnuWanProvisioningService } from './onu-wan-provisioning.service';
import { OnuServiceConfigEntity } from '../entities/onu-service-config.entity';
import { OnuWanOperationEntity } from '../entities/onu-wan-operation.entity';
import { encryptCredential } from '../../network-connectivity/utils/crypto.util';
import { NotFoundException } from '@nestjs/common';

describe('OnuWanProvisioningService', () => {
  let service: OnuWanProvisioningService;
  let config: any;
  let onu: any;
  let configs: any;
  let operations: any;
  let accesses: any;
  let cpe: any;
  let driver: any;
  let acs: any;
  let prior: any;
  let operation: any;
  let manager: any;

  beforeEach(() => {
    prior = null;
    operation = null;
    config = { id: 'config-1', onuId: 'onu-1', operationMode: 'ROUTER', managementMethod: 'TR069',
      tr069NetworkId: 'net-1', serviceVlanId: 'vlan-1', wanProvisioningMethod: 'TR069', wanDesiredVersion: 0, wanMode: 'PPPOE', ipProtocol: 'IPV4',
      omciWanProfile: { oltId: 'olt-1', enabled: true, validation: 'PILOT', serialNumber: 'HWTC1234', oltFirmware: 'V2', onuFirmware: 'V1', vendorTypeName: 'HG8546M', vlanProfile: 'Internet400', serviceVlan: 400, wanIndex: 1, hostId: 1, auth: 'auto', evidence: 'Laboratorio aislado' },
    };
    onu = { id: 'onu-1', oltId: 'olt-1', serialNumber: 'HWTC1234', contractId: 'contract-1', onuIndex: 'gpon-onu_1/2/1:1', status: 'ACTIVE',
      olt: { id: 'olt-1', vendor: 'ZTE', model: 'C320', firmwareVersion: 'V2' }, onuType: { vendor: 'HUAWEI', model: 'HG8546M', vendorTypeName: 'HG8546M' },
      serviceConfig: { ...config, serviceVlan: { vlanId: 400 }, tr069Network: { acsUrl: 'http://10.0.0.1:7547' } },
    };
    const updateQb: any = { update: jest.fn().mockReturnThis(), set: jest.fn().mockImplementation(patch => { updateQb.patch = patch; return updateQb; }), where: jest.fn().mockReturnThis(), execute: jest.fn().mockImplementation(async () => { Object.assign(config, updateQb.patch); return { affected: 1 }; }) };
    configs = { findOneBy: jest.fn().mockImplementation(async () => config), createQueryBuilder: () => updateQb,
      update: jest.fn().mockImplementation(async (_where, patch) => { Object.assign(config, patch); return { affected: 1 }; }) };
    const readQb: any = { addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), getOne: jest.fn().mockImplementation(async () => prior) };
    operations = { createQueryBuilder: () => readQb, create: jest.fn(x => x), save: jest.fn(async x => operation = { id: 'op-1', ...x }),
      update: jest.fn(async (_id, patch) => { Object.assign(operation, patch); return { affected: 1 }; }),
      findOneBy: jest.fn(async where => operation?.id === where.id && operation?.onuId === where.onuId ? operation : null),
      findOne: jest.fn(async () => operation),
    };
    accesses = { findOneBy: jest.fn().mockResolvedValue({ username: 'cliente@example', pppoePasswordEnc: encryptCredential('Private123!') }) };
    manager = { query: jest.fn(), getRepository: entity => entity === OnuServiceConfigEntity ? configs : entity === OnuWanOperationEntity ? operations : null };
    const tenant: any = { getSlug: () => 'tenant-test', getDataSource: () => ({ transaction: callback => callback(manager), query: jest.fn() }) };
    const policy: any = { withOnu: (_id, callback) => callback(), withManagedWrite: (_id, _method, _version, callback) => callback() };
    driver = { configureOnuWan: jest.fn().mockResolvedValue({ status: 'APPLIED', configuration: { wanIndex: 1, evidence: 'password ***' } }) };
    const registry: any = { resolve: () => driver };
    const connections: any = { resolve: jest.fn().mockResolvedValue({}) };
    cpe = { configureCpe: jest.fn().mockResolvedValue({ applicationStatus: 'APPLIED', deviceId: 'device-1', appliedParametersCount: 4 }) };
    acs = { findDeviceBySerial: jest.fn().mockResolvedValue('device-1'), getPendingDeviceTasks: jest.fn().mockResolvedValue([]), setDeviceTag: jest.fn(), deleteDeviceTag: jest.fn() };
    service = new OnuWanProvisioningService(configs, operations, accesses, tenant, policy, registry, connections, cpe, acs);
  });

  it('uses credentials from the contract, persists a version and dispatches TR-069', async () => {
    const result = await service.configure(onu, { provisioningMethod: 'TR069' }, 'actor-1');
    expect(cpe.configureCpe).toHaveBeenCalledWith(expect.objectContaining({ pppoeUsername: 'cliente@example', pppoePassword: 'Private123!', serviceVlan: 400 }));
    expect(result).toMatchObject({ id: 'op-1', method: 'TR069', version: 1, status: 'APPLIED', actor: 'actor-1' });
    expect(config).toMatchObject({ wanAppliedMethod: 'TR069', wanAppliedVersion: 1 });
    expect(JSON.stringify(result)).not.toContain('Private123!');
    expect(driver.configureOnuWan).not.toHaveBeenCalled();
  });

  it('applies OMCI without requiring a TR-069 profile and preserves the management method', async () => {
    config.managementMethod = 'OMCI'; config.tr069NetworkId = null;
    const result = await service.configure(onu, { provisioningMethod: 'OMCI' });
    expect(result.method).toBe('OMCI');
    expect(config.managementMethod).toBe('OMCI');
    expect(driver.configureOnuWan).toHaveBeenCalledWith({}, expect.objectContaining({ username: 'cliente@example', serialNumber: 'HWTC1234' }));
    expect(cpe.configureCpe).not.toHaveBeenCalled();
  });

  it.each([
    ['Bridge', c => c.operationMode = 'BRIDGE', { provisioningMethod: 'OMCI' }],
    ['missing credentials', (_c, accesses) => accesses.findOneBy.mockResolvedValue(null), { provisioningMethod: 'OMCI' }],
    ['unknown profile', c => c.omciWanProfile = null, { provisioningMethod: 'OMCI' }],
    ['DHCP over OMCI', () => {}, { provisioningMethod: 'OMCI', wanMode: 'DHCP' }],
    ['Dual-Stack over OMCI', () => {}, { provisioningMethod: 'OMCI', ipProtocol: 'DUAL' }],
    ['stale version', () => {}, { provisioningMethod: 'OMCI', expectedVersion: 99 }],
  ])('rejects %s before any device writes', async (_name, mutate, dto) => {
    mutate(config, accesses);
    await expect(service.configure(onu, dto as any)).rejects.toThrow();
    expect(driver.configureOnuWan).not.toHaveBeenCalled(); expect(cpe.configureCpe).not.toHaveBeenCalled();
    expect(operations.save).not.toHaveBeenCalled();
  });

  it('does not hand ownership to OMCI while an ACS task is pending', async () => {
    acs.getPendingDeviceTasks.mockResolvedValue([{ _id: 'queued-task' }]);
    await expect(service.configure(onu, { provisioningMethod: 'OMCI' })).rejects.toThrow('pendientes');
    expect(operations.save).not.toHaveBeenCalled();
    expect(driver.configureOnuWan).not.toHaveBeenCalled();
  });

  it('preserves queued state instead of advancing applied version', async () => {
    cpe.configureCpe.mockResolvedValue({ applicationStatus: 'QUEUED', deviceId: 'device-1', taskId: 'task-1' });
    const result = await service.configure(onu, {});
    expect(result.status).toBe('QUEUED');
    expect(config.wanAppliedVersion).toBeUndefined();
  });

  it('returns the same operation for an equivalent request and blocks an uncertain replacement', async () => {
    const first = await service.configure(onu, {});
    prior = first;
    expect(await service.configure(onu, {})).toBe(first);
    expect(cpe.configureCpe).toHaveBeenCalledTimes(1);
    prior.status = 'UNKNOWN';
    await expect(service.configure(onu, { wanMode: 'DHCP' })).rejects.toThrow('incierta');
  });

  it('persists IPv4 static parameters for future reconciliation', async () => {
    await service.configure(onu, { wanMode: 'STATIC', wanStaticIp: '192.0.2.2', wanStaticMask: '255.255.255.0', wanStaticGw: '192.0.2.1' });
    expect(config).toMatchObject({ wanStaticIp: '192.0.2.2', wanStaticMask: '255.255.255.0', wanStaticGw: '192.0.2.1' });
    expect(accesses.findOneBy).not.toHaveBeenCalled();
  });

  it('does not leak credentials from a device exception', async () => {
    driver.configureOnuWan.mockRejectedValue(new Error('timeout password Private123!'));
    const result = await service.configure(onu, { provisioningMethod: 'OMCI' });
    expect(result.status).toBe('UNKNOWN');
    expect(JSON.stringify(result)).not.toContain('Private123!');
  });

  it('cannot read operations of a different ONU', async () => {
    await service.configure(onu, {});
    await expect(service.getOperation('other-onu', 'op-1')).rejects.toThrow('no encontrada');
  });

  it('allows an idempotent repeat with the original expected version', async () => {
    const first = await service.configure(onu, { expectedVersion: 0 });
    prior = first;
    expect(await service.configure(onu, { expectedVersion: 0 })).toBe(first);
    expect(cpe.configureCpe).toHaveBeenCalledTimes(1);
  });

  it('checks completion and fresh readback before promoting a queued task', async () => {
    cpe.configureCpe.mockResolvedValue({ applicationStatus: 'QUEUED', deviceId: 'device-1', taskId: 'task-1', expectedReadback: { 'Device.PPP.Interface.1.Enable': 'true' } });
    await service.configure(onu, {});
    acs.isTaskComplete = jest.fn().mockResolvedValue(true);
    acs.refreshParameterValues = jest.fn().mockResolvedValue({ 'Device.PPP.Interface.1.Enable': 'true' });
    const result = await service.verify(onu);
    expect(result?.status).toBe('APPLIED');
    expect(cpe.configureCpe).toHaveBeenCalledTimes(1);
  });

  it('observes an uncertain OMCI write without automatically resending it', async () => {
    driver.configureOnuWan.mockResolvedValue({ status: 'UNKNOWN' });
    await service.configure(onu, { provisioningMethod: 'OMCI' });
    driver.getOnuWanConfiguration = jest.fn().mockResolvedValue({ mode: 'pppoe', username: 'cliente@example', vlanProfile: 'Internet400', hostId: 1, serialNumber: 'HWTC1234', vendorTypeName: 'HG8546M', configState: 'success' });
    const result = await service.verify(onu);
    expect(result?.status).toBe('UNKNOWN');
    expect(driver.configureOnuWan).toHaveBeenCalledTimes(1);
  });

  it('preserves an IPv6 readback from the existing TR-069 implementation', async () => {
    cpe.configureCpe.mockResolvedValue({ applicationStatus: 'APPLIED', ipv6Readback: { prefix: '2001:db8::/56', address: '2001:db8::1' } });
    await service.configure(onu, { ipProtocol: 'DUAL' });
    expect(config).toMatchObject({ pppoeIpv6Prefix: '2001:db8::/56', pppoeIpv6Address: '2001:db8::1' });
  });

  it('registers disabled pilot metadata without sending device commands', async () => {
    const p = { ...config.omciWanProfile, enabled: false };
    await service.saveOmciProfile(onu, p, 'admin-1');
    expect(manager.query).toHaveBeenCalled();
    expect(config.omciWanProfile.enabled).toBe(false);
    expect(driver.configureOnuWan).not.toHaveBeenCalled();
    expect(cpe.configureCpe).not.toHaveBeenCalled();
  });

  it('cannot use the TR-069 management IP-host for Internet PPPoE', async () => {
    await expect(service.saveOmciProfile(onu, { ...config.omciWanProfile, hostId: 2 })).rejects.toThrow('reservado');
  });

  it('backs off before safely retrying a first-Inform failure on the same intent version', async () => {
    cpe.configureCpe.mockRejectedValueOnce(new NotFoundException('El CPE todavía no envió Inform.'));
    const first = await service.configure(onu, {});
    expect(first).toMatchObject({ status: 'ERROR', attempts: 1, evidence: { safeToRetry: true } });
    prior = first;
    onu.serviceConfig = { ...onu.serviceConfig, wanApplyStatus: 'ERROR', wanDesiredVersion: 1 };
    await service.reconcile(onu);
    expect(cpe.configureCpe).toHaveBeenCalledTimes(1);
    first.finishedAt = new Date(Date.now() - 120001);
    const result = await service.reconcile(onu);
    expect(result).toMatchObject({ id: first.id, version: 1, attempts: 2, status: 'APPLIED' });
    expect(operations.save).toHaveBeenCalledTimes(1);
  });

  it('stops safe automatic retries after five attempts', async () => {
    cpe.configureCpe.mockRejectedValue(new NotFoundException('Sin Inform.'));
    prior = await service.configure(onu, {});
    prior.attempts = 5; prior.finishedAt = new Date(0);
    onu.serviceConfig = { ...onu.serviceConfig, wanApplyStatus: 'ERROR', wanDesiredVersion: 1 };
    await service.reconcile(onu);
    expect(cpe.configureCpe).toHaveBeenCalledTimes(1);
  });
});
