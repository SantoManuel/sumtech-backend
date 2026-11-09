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
    acs = { findDeviceBySerial: jest.fn().mockResolvedValue('device-1'), getPendingDeviceTasks: jest.fn().mockResolvedValue([]), setDeviceTag: jest.fn(), deleteDeviceTag: jest.fn(), clearDeviceTasks: jest.fn().mockResolvedValue({ deleted: 0, failed: 0 }), deleteTask: jest.fn().mockResolvedValue(undefined), getDeviceStatus: jest.fn().mockResolvedValue({ manufacturer: "Huawei Technologies Co., Ltd" }) };
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

  it('enables and sends the standard OMCI block with no registered recipe or firmware inventory', async () => {
    config.omciWanProfile = null;
    delete onu.olt.firmwareVersion;
    delete onu.onuType;
    onu.serviceConfig = { ...onu.serviceConfig, omciWanProfile: null };
    expect(service.capabilities(onu).OMCI).toMatchObject({ status: 'SUPPORTED', enabled: true, reason: null });
    const op = await service.configure(onu, { provisioningMethod: 'OMCI' }, 'admin-1');
    expect(op.status).toBe('APPLIED');
    expect(driver.configureOnuWan).toHaveBeenCalledWith({}, expect.objectContaining({
      username: 'cliente@example', password: 'Private123!',
      profile: expect.objectContaining({ commandStyle: 'WAN_SERVICE', wanIndex: 1, hostId: 1,
        ethUniPorts: '1-4', ssidPorts: '1-4', serviceVlan: 400, enabled: true, validation: 'STANDARD' }),
    }));
    expect(config.omciWanProfile.commandStyle).toBe('WAN_SERVICE');
  });

  it('does not require enabling an old lab profile to send the provided commands', async () => {
    config.omciWanProfile.enabled = false;
    expect(service.capabilities(onu).OMCI.enabled).toBe(true);
    await service.configure(onu, { provisioningMethod: 'OMCI' });
    expect(driver.configureOnuWan).toHaveBeenCalledWith({}, expect.objectContaining({ profile: expect.objectContaining({ commandStyle: 'WAN_SERVICE', enabled: true }) }));
  });

  it('preserves command options for a legacy WAN that was already applied', async () => {
    config.wanAppliedMethod = 'OMCI'; config.wanAppliedVersion = 1;
    await service.configure(onu, { provisioningMethod: 'OMCI' });
    expect(driver.configureOnuWan).toHaveBeenCalledWith({}, expect.objectContaining({
      profile: expect.objectContaining({ commandStyle: 'WAN_IP', vlanProfile: 'Internet400', auth: 'auto' }),
    }));
  });

  it('uses the declared LAN port count without asking for a manual binding range', async () => {
    onu.onuType.ethPorts = 1;
    await service.configure(onu, { provisioningMethod: 'OMCI' });
    expect(driver.configureOnuWan).toHaveBeenCalledWith({}, expect.objectContaining({ profile: expect.objectContaining({ ethUniPorts: '1', ssidPorts: '1-4' }) }));
  });

  it.each([
    ['Bridge', c => c.operationMode = 'BRIDGE', { provisioningMethod: 'OMCI' }],
    ['missing credentials for PPPoE', (_c, accesses) => accesses.findOneBy.mockResolvedValue(null), { provisioningMethod: 'OMCI', wanMode: 'PPPOE' }],
    ['Dual-Stack over OMCI', () => {}, { provisioningMethod: 'OMCI', ipProtocol: 'DUAL' }],
    ['stale version', () => {}, { provisioningMethod: 'OMCI', expectedVersion: 99 }],
  ])('rejects %s before any device writes', async (_name, mutate, dto) => {
    mutate(config, accesses);
    await expect(service.configure(onu, dto as any)).rejects.toThrow();
    expect(driver.configureOnuWan).not.toHaveBeenCalled(); expect(cpe.configureCpe).not.toHaveBeenCalled();
    expect(operations.save).not.toHaveBeenCalled();
  });

  it('configures DHCP over OMCI without requiring PPPoE credentials', async () => {
    accesses.findOneBy.mockResolvedValue(null);
    driver.configureOnuWan.mockResolvedValue({ status: 'APPLIED', configuration: { wanIndex: 1, mode: 'dhcp', dhcpEnabled: true, evidence: 'ip-host 1 dhcp-enable' } });
    const op = await service.configure(onu, { provisioningMethod: 'OMCI', wanMode: 'DHCP' });
    expect(op.status).toBe('APPLIED');
    expect(driver.configureOnuWan).toHaveBeenCalledWith({}, expect.objectContaining({ wanMode: 'DHCP' }));
  });

  it('tags WAN_OMCI in GenieACS and clears pending tasks when handing ownership to OMCI', async () => {
    acs.getPendingDeviceTasks.mockResolvedValue([{ _id: 'queued-task' }]);
    const op = await service.configure(onu, { provisioningMethod: 'OMCI' });
    expect(op.status).toBe('APPLIED');
    expect(acs.setDeviceTag).toHaveBeenCalledWith('device-1', 'WAN_OMCI');
    expect(acs.clearDeviceTasks).toHaveBeenCalledWith('device-1');
    expect(driver.configureOnuWan).toHaveBeenCalledTimes(1);
  });

  it('preserves queued state instead of advancing applied version', async () => {
    cpe.configureCpe.mockResolvedValue({ applicationStatus: 'QUEUED', deviceId: 'device-1', taskId: 'task-1' });
    const result = await service.configure(onu, {});
    expect(result.status).toBe('QUEUED');
    expect(config.wanAppliedVersion).toBeUndefined();
  });

  it('does not reject a TR-069 WAN because read-only or Wi-Fi tasks are pending', async () => {
    acs.getPendingDeviceTasks.mockResolvedValue([
      { _id: 'read-1', name: 'refreshObject', objectName: 'InternetGatewayDevice.WANDevice.' },
      { _id: 'wifi-1', name: 'setParameterValues', parameterValues: [['Device.WiFi.SSID.1.SSID', 'Home', 'xsd:string']] },
    ]);
    expect((await service.configure(onu, { provisioningMethod: 'TR069' })).status).toBe('APPLIED');
    expect(cpe.configureCpe).toHaveBeenCalledTimes(1);
  });

  it('reports the identifiers of conflicting WAN tasks without exposing their passwords', async () => {
    acs.getPendingDeviceTasks.mockResolvedValue([
      { _id: 'wan-1', name: 'setParameterValues', parameterValues: [['Device.PPP.Interface.1.Password', 'QueueSecret!', 'xsd:string']] },
    ]);
    let conflict: any;
    try { await service.configure(onu, { provisioningMethod: 'TR069' }); } catch (error) { conflict = error; }
    expect(conflict?.getStatus()).toBe(409);
    const body = conflict.getResponse();
    expect(body).toMatchObject({ code: 'WAN_ACS_TASKS_PENDING', pendingTasks: [{ id: 'wan-1', name: 'setParameterValues' }] });
    expect(JSON.stringify(body)).not.toContain('QueueSecret!');
    expect(cpe.configureCpe).not.toHaveBeenCalled();
  });

  it('drains and clears pending ACS tasks when switching to OMCI without blocking the OLT write', async () => {
    acs.getPendingDeviceTasks.mockResolvedValue([{ _id: 'read-1', name: 'getParameterValues' }]);
    const result = await service.configure(onu, { provisioningMethod: 'OMCI' });
    expect(result.status).toBe('APPLIED');
    expect(acs.clearDeviceTasks).toHaveBeenCalledWith('device-1');
    expect(driver.configureOnuWan).toHaveBeenCalledTimes(1);
  });

  it('proceeds with OMCI provisioning even if ACS task clearance fails or ACS is offline', async () => {
    acs.getPendingDeviceTasks.mockRejectedValue(new Error('GenieACS down'));
    const result = await service.configure(onu, { provisioningMethod: 'OMCI' });
    expect(result.status).toBe('APPLIED');
    expect(driver.configureOnuWan).toHaveBeenCalledTimes(1);
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

  it('does not send the automatic OMCI block twice after persisting its options', async () => {
    config.omciWanProfile = null;
    const first = await service.configure(onu, { provisioningMethod: 'OMCI', expectedVersion: 0 });
    prior = first;
    expect(await service.configure(onu, { provisioningMethod: 'OMCI', expectedVersion: 0 })).toBe(first);
    expect(driver.configureOnuWan).toHaveBeenCalledTimes(1);
    expect(config.wanDesiredVersion).toBe(1);
  });

  it('checks completion and fresh readback before promoting a queued task', async () => {
    cpe.configureCpe.mockResolvedValue({ applicationStatus: 'QUEUED', deviceId: 'device-1', taskId: 'task-1', expectedReadback: { 'Device.PPP.Interface.1.Enable': 'true' } });
    await service.configure(onu, {});
    acs.getPendingDeviceTasks.mockResolvedValue([{ _id: 'read-2', name: 'getParameterValues' }]);
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

  it('registers the WAN service recipe without requiring legacy VLAN profile fields', async () => {
    const profile = { ...config.omciWanProfile, commandStyle: 'WAN_SERVICE', vlanProfile: undefined, auth: undefined, ethUniPorts: '1-4', ssidPorts: '1-4' };
    await service.saveOmciProfile(onu, profile, 'admin-1');
    expect(config.omciWanProfile).toMatchObject({ commandStyle: 'WAN_SERVICE', ethUniPorts: '1-4', ssidPorts: '1-4' });
    await service.configure(onu, { provisioningMethod: 'OMCI' }, 'admin-1');
    expect(driver.configureOnuWan).toHaveBeenCalledWith({}, expect.objectContaining({
      username: 'cliente@example', password: 'Private123!', profile: expect.objectContaining({ commandStyle: 'WAN_SERVICE', serviceVlan: 400 }),
    }));
  });

  it('rejects descending port ranges and bindings beyond the declared Ethernet ports before saving', async () => {
    const profile = { ...config.omciWanProfile, commandStyle: 'WAN_SERVICE', ethUniPorts: '4-1', ssidPorts: '1-4' };
    await expect(service.saveOmciProfile(onu, profile)).rejects.toThrow('ascendente');
    onu.onuType.ethPorts = 1;
    await expect(service.saveOmciProfile(onu, { ...profile, ethUniPorts: '1-4' })).rejects.toThrow('supera');
    expect(configs.update).not.toHaveBeenCalled();
  });

  it('does not confirm a delayed WAN service operation until NAT and bindings also match', async () => {
    config.omciWanProfile = { ...config.omciWanProfile, commandStyle: 'WAN_SERVICE', ethUniPorts: '1-4', ssidPorts: '1-4' };
    driver.configureOnuWan.mockResolvedValue({ status: 'VERIFYING' });
    await service.configure(onu, { provisioningMethod: 'OMCI' });
    const observed = { wanIndex: 1, commandStyle: 'WAN_SERVICE', mode: 'pppoe', username: 'cliente@example',
      service: 'internet', bindingService: 'internet', hostId: 1, ethUniPorts: '1-4', ssidPorts: '1-4',
      natEnabled: false, vlanMode: 'tag', serviceVlan: 400,
      serialNumber: 'HWTC1234', vendorTypeName: 'HG8546M', configState: 'success' };
    driver.getOnuWanConfiguration = jest.fn().mockResolvedValue(observed);
    expect((await service.verify(onu))?.status).toBe('VERIFYING');
    observed.natEnabled = true;
    expect((await service.verify(onu))?.status).toBe('APPLIED');
  });

  it('requires an explicit transition before changing the command style of an applied recipe', async () => {
    config.wanAppliedMethod = 'OMCI';
    await expect(service.saveOmciProfile(onu, { ...config.omciWanProfile, commandStyle: 'WAN_SERVICE', ethUniPorts: '1-4', ssidPorts: '1-4' }))
      .rejects.toThrow('Cambia primero');
    expect(configs.update).not.toHaveBeenCalled();
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

  it('lanza BadRequestException si se intenta configurar WAN PPPoE sin un contrato vinculado', async () => {
    onu.contractId = null;
    await expect(service.configure(onu, { provisioningMethod: 'TR069', wanMode: 'PPPOE' }))
      .rejects.toThrow('Esta ONU no tiene un contrato vinculado. Vincula un contrato antes de configurar la WAN PPPoE.');
    expect(cpe.configureCpe).not.toHaveBeenCalled();
  });

  it('resuelve effectiveVendor desde acs.getDeviceStatus si onuType.vendor es ALL', async () => {
    onu.onuType = { vendor: 'ALL', model: 'HG8546M', vendorTypeName: 'HG8546M' };
    acs.getDeviceStatus.mockResolvedValue({ manufacturer: 'Huawei Technologies Co., Ltd' });

    await service.configure(onu, { provisioningMethod: 'TR069' });

    expect(cpe.configureCpe).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor: 'Huawei Technologies Co., Ltd',
      })
    );
  });
});