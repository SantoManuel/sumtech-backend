import { HiosoDriver } from './hioso.driver';
import { DriverNotImplementedError } from '../ports/olt-driver.port';
import * as fs from 'fs';
import * as path from 'path';

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, '../../../../test/fixtures/hioso', name), 'utf8');

describe('HiosoDriver', () => {
  let driver: HiosoDriver;

  beforeEach(() => {
    driver = new HiosoDriver();
  });

  it('debe estar definido', () => {
    expect(driver).toBeDefined();
  });

  it('solo declara capacidades reales: testConnection, systemInfo y discoverInterfaces', () => {
    expect(driver.getCapabilities()).toEqual({
      testConnection: true,
      systemInfo: true,
      discoverInterfaces: true,
      configureVlan: false,
      onuDiscovery: false,
      onuOpticalPower: false,
      onuAuthorize: false,
      onuAdminState: false,
      onuDelete: false,
    });
  });

  it('devuelve ok:false con mensaje legible si el host OLT no es alcanzable', async () => {
    const result = await driver.testConnection({
      host: '192.0.2.1',
      port: 23,
      username: 'admin',
      password: 'wrong',
      timeoutMs: 300,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('parsea show version + show system (firmware, modelo, uptime) con la evidencia real capturada', async () => {
    const versionOut = fixture('show_version.txt');
    const systemOut = fixture('show_system.txt');

    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand: jest.fn().mockImplementation((cmd: string) => {
        if (cmd === 'show version') return Promise.resolve(versionOut);
        if (cmd === 'show system') return Promise.resolve(systemOut);
        throw new Error(`comando inesperado en el test: ${cmd}`);
      }),
      close: jest.fn(),
    });

    const result = await driver.getSystemInfo({
      host: '172.16.100.5',
      port: 2324,
      username: 'admin',
      password: 'admin',
    });

    expect(result.vendor).toBe('HiOSO');
    expect(result.model).toBe('EPON');
    expect(result.firmwareVersion).toBe('V1.1.21');
    expect(result.uptime).toBe('1h 54m 38s');
  });

  it('parsea show interfaces status y distingue puertos Epon (PON) de uplinks', async () => {
    const statusOut = fixture('show_interfaces_status.txt');

    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand: jest.fn().mockResolvedValue(statusOut),
      close: jest.fn(),
    });

    const result = await driver.discoverInterfaces({
      host: '172.16.100.5',
      port: 2324,
      username: 'admin',
      password: 'admin',
    });

    const epon1 = result.find((i) => i.name === 'epon 1/1');
    expect(epon1).toBeDefined();
    expect(epon1!.type).toBe('PON');
    expect(epon1!.slot).toBe(1);
    expect(epon1!.port).toBe(1);
    expect(epon1!.operState).toBe('DOWN');
    expect(epon1!.adminState).toBe('UP');

    const eponPorts = result.filter((i) => i.type === 'PON');
    expect(eponPorts).toHaveLength(4);

    const ge1 = result.find((i) => i.name === 'gigabitethernet 1/1');
    expect(ge1).toBeDefined();
    expect(ge1!.type).toBe('UPLINK');

    const tenGe1 = result.find((i) => i.name === 'ten-gigabitethernet 1/1');
    expect(tenGe1).toBeDefined();
    expect(tenGe1!.type).toBe('UPLINK');
    // Ten-Gigabit Ethernet 1/1 no tiene bloque de "Current Status" en la
    // salida real (SFP no presente) -> sin evidencia de "Up", se asume DOWN.
    expect(tenGe1!.operState).toBe('DOWN');
  });

  it('las operaciones no verificadas contra hardware siguen señalando DRIVER_NOT_IMPLEMENTED', async () => {
    const params = { host: '172.16.100.5', port: 2324, username: 'admin', password: 'admin' };

    const vlanResult = await driver.configureVlanOnInterface(params, {
      interfaceName: 'epon 1/1',
      vlanId: 400,
      mode: 'TAG',
    });
    expect(vlanResult.ok).toBe(false);

    await expect(driver.getUnconfiguredOnus(params)).rejects.toThrow(DriverNotImplementedError);
    await expect(driver.getOnuOpticalPower(params, 'epon 1/1:1')).rejects.toThrow(DriverNotImplementedError);

    const authResult = await driver.authorizeOnu(params, {
      ponInterface: 'epon 1/1',
      onuId: 1,
      modelTypeName: 'HIOSO-GENERIC',
      serialNumber: 'HIOSO0000001',
      serviceVlan: 400,
      managementMethod: 'OMCI',
      operationMode: 'ROUTER',
    });
    expect(authResult.ok).toBe(false);
  });
});
