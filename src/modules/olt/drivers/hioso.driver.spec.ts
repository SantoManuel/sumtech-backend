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

  it('solo declara capacidades reales: todo menos chassisCards y configureVlan (sin comando verificado para ninguno de los dos)', () => {
    expect(driver.getCapabilities()).toEqual({
      testConnection: true,
      systemInfo: true,
      systemHealth: true,
      chassisCards: false,
      discoverInterfaces: true,
      configureVlan: false,
      onuDiscovery: true,
      onuOpticalPower: true,
      onuAuthorize: true,
      onuAdminState: true,
      onuDelete: true,
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

  it('parsea show process cpu + show memory + show system (CPU%, memoria% y uptime en segundos) con evidencia real', async () => {
    const cpuOut = fixture('show_process_cpu.txt');
    const memOut = fixture('show_memory.txt');
    const systemOut = fixture('show_system.txt');

    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand: jest.fn().mockImplementation((cmd: string) => {
        if (cmd === 'show process cpu') return Promise.resolve(cpuOut);
        if (cmd === 'show memory') return Promise.resolve(memOut);
        if (cmd === 'show system') return Promise.resolve(systemOut);
        throw new Error(`comando inesperado en el test: ${cmd}`);
      }),
      close: jest.fn(),
    });

    const result = await driver.getSystemHealth({
      host: '172.16.100.5',
      port: 2324,
      username: 'admin',
      password: 'admin',
    });

    expect(result.cpuUsagePercent).toBe(6);
    // Used 37304 / Total 256544 ≈ 14.54% -> redondeado a 15
    expect(result.memoryUsagePercent).toBe(15);
    // 1h 54m 38s
    expect(result.uptimeSeconds).toBe(1 * 3600 + 54 * 60 + 38);
    // Sin evidencia real de temperatura de chasis en este equipo
    expect(result.temperatureCelsius).toBeUndefined();
  });

  it('getCards() sigue señalando DRIVER_NOT_IMPLEMENTED: este hardware no tiene chasis modular', async () => {
    await expect(
      driver.getCards({ host: '172.16.100.5', port: 2324, username: 'admin', password: 'admin' }),
    ).rejects.toThrow(DriverNotImplementedError);
  });

  it('parsea la potencia óptica real de un ONU online (incluye RxPower, verificado con hardware real)', async () => {
    const onlineOut = fixture('show_onu_optical-ddm_online.txt');

    const executeCommand = jest.fn().mockResolvedValue(onlineOut);
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand,
      close: jest.fn(),
    });

    const result = await driver.getOnuOpticalPower(
      { host: '172.16.100.5', port: 2324, username: 'admin', password: 'admin' },
      'epon 1/1:2',
    );

    expect(executeCommand).toHaveBeenCalledWith('show onu optical-ddm epon 1/1 2');
    expect(result.rxDbm).toBe(-4.43);
    expect(result.txDbm).toBe(2.32);
    expect(result.downRxDbm).toBe(-4.43);
  });

  it('getOnuOpticalPower() no inventa valores cuando el ONU está offline/invalid', async () => {
    const offlineOut = fixture('show_onu_optical-ddm_offline.txt');

    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand: jest.fn().mockResolvedValue(offlineOut),
      close: jest.fn(),
    });

    const result = await driver.getOnuOpticalPower(
      { host: '172.16.100.5', port: 2324, username: 'admin', password: 'admin' },
      'epon 1/1:1',
    );

    expect(result.rxDbm).toBeUndefined();
    expect(result.txDbm).toBeUndefined();
    expect(result.raw).toContain('offline');
  });

  it('getUnconfiguredOnus() con ponInterface explícito: parsea show onu upgrade-state, descarta la fila Down (binding viejo) y usa la MAC como serialNumber', async () => {
    const upgradeStateOut = fixture('show_onu_upgrade-state.txt');

    const executeCommand = jest.fn().mockResolvedValue(upgradeStateOut);
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand,
      close: jest.fn(),
    });

    const result = await driver.getUnconfiguredOnus(
      { host: '172.16.100.5', port: 2324, username: 'admin', password: 'admin' },
      'epon 1/1',
    );

    expect(executeCommand).toHaveBeenCalledWith('show onu upgrade-state epon 1/1');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      ponInterface: 'epon 1/1',
      onuIndex: '2',
      serialNumber: '04:b0:e7:d3:09:a6',
      vendor: 'HiOSO',
    });
  });

  it('getUnconfiguredOnus() sin ponInterface: descubre los puertos EPON reales y consulta cada uno', async () => {
    const statusOut = fixture('show_interfaces_status.txt');
    const upgradeStateOut = fixture('show_onu_upgrade-state.txt');

    const executeCommand = jest.fn().mockImplementation((cmd: string) => {
      if (cmd === 'show interfaces status') return Promise.resolve(statusOut);
      if (cmd === 'show onu upgrade-state epon 1/1') return Promise.resolve(upgradeStateOut);
      if (/^show onu upgrade-state epon /.test(cmd)) {
        return Promise.resolve(
          'OnuId  MacAddress        Status  ChipId Ge Fe Pots CtcStatus      CtcVer Uptime           Firmware         UpgradeState\n' +
            '=======================================================================================================================',
        );
      }
      throw new Error(`comando inesperado en el test: ${cmd}`);
    });
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand,
      close: jest.fn(),
    });

    const result = await driver.getUnconfiguredOnus({
      host: '172.16.100.5',
      port: 2324,
      username: 'admin',
      password: 'admin',
    });

    expect(executeCommand).toHaveBeenCalledWith('show interfaces status');
    expect(executeCommand).toHaveBeenCalledWith('show onu upgrade-state epon 1/1');
    expect(executeCommand).toHaveBeenCalledWith('show onu upgrade-state epon 1/2');
    expect(executeCommand).toHaveBeenCalledWith('show onu upgrade-state epon 1/3');
    expect(executeCommand).toHaveBeenCalledWith('show onu upgrade-state epon 1/4');
    expect(result).toEqual([
      {
        ponInterface: 'epon 1/1',
        onuIndex: '2',
        serialNumber: '04:b0:e7:d3:09:a6',
        vendor: 'HiOSO',
      },
    ]);
  });

  it('configureVlanOnInterface() sigue señalando DRIVER_NOT_IMPLEMENTED: no hay comando verificado para VLAN en un puerto uplink/NNI', async () => {
    const vlanResult = await driver.configureVlanOnInterface(
      { host: '172.16.100.5', port: 2324, username: 'admin', password: 'admin' },
      { interfaceName: 'epon 1/1', vlanId: 400, mode: 'TAG' },
    );
    expect(vlanResult.ok).toBe(false);
  });

  it('generateAuthorizationScript() produce la secuencia real confirmada: add onu <id> <mac> <type> + VLAN en los 4 puertos LAN', () => {
    const commands = driver.generateAuthorizationScript({
      ponInterface: 'epon 1/1',
      onuId: 2,
      modelTypeName: 'onu-01g',
      serialNumber: '04:b0:e7:aa:bb:cc',
      serviceVlan: 400,
      managementMethod: 'OMCI',
      operationMode: 'ROUTER',
    });

    expect(commands).toEqual([
      'configure terminal',
      'interface epon 1/1',
      'add onu 2 04:b0:e7:aa:bb:cc onu-01g',
      'onu 2 vlan port 1 vlan-mode tag pvid 400',
      'onu 2 vlan port 2 vlan-mode tag pvid 400',
      'onu 2 vlan port 3 vlan-mode tag pvid 400',
      'onu 2 vlan port 4 vlan-mode tag pvid 400',
      'exit',
      'exit',
      'write',
    ]);
  });

  it('authorizeOnu() ejecuta la secuencia de generateAuthorizationScript() y responde ok:true', async () => {
    const executeCommand = jest.fn().mockResolvedValue('');
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand,
      close: jest.fn(),
    });

    const result = await driver.authorizeOnu(
      { host: '172.16.100.5', port: 2324, username: 'admin', password: 'admin' },
      {
        ponInterface: 'epon 1/1',
        onuId: 2,
        modelTypeName: 'onu-01g',
        serialNumber: '04:b0:e7:aa:bb:cc',
        serviceVlan: 400,
        managementMethod: 'OMCI',
        operationMode: 'ROUTER',
      },
    );

    expect(result.ok).toBe(true);
    expect(executeCommand).toHaveBeenCalledWith('add onu 2 04:b0:e7:aa:bb:cc onu-01g');
    expect(executeCommand).toHaveBeenCalledWith('onu 2 vlan port 4 vlan-mode tag pvid 400');
  });

  it('authorizeOnu() responde ok:false con el mensaje del equipo si un comando falla a mitad de secuencia', async () => {
    const executeCommand = jest.fn().mockImplementation((cmd: string) => {
      if (cmd.startsWith('add onu')) {
        return Promise.reject(new Error('! De-register onu failed!'));
      }
      return Promise.resolve('');
    });
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand,
      close: jest.fn(),
    });

    const result = await driver.authorizeOnu(
      { host: '172.16.100.5', port: 2324, username: 'admin', password: 'admin' },
      {
        ponInterface: 'epon 1/1',
        onuId: 2,
        modelTypeName: 'onu-01g',
        serialNumber: '04:b0:e7:aa:bb:cc',
        serviceVlan: 400,
        managementMethod: 'OMCI',
        operationMode: 'ROUTER',
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('! De-register onu failed!');
  });

  it.each([
    ['BLOCKED', 'onu 2 deactivate'],
    ['ACTIVE', 'onu 2 activate'],
  ])('setOnuAdminState(%s) usa el comando real confirmado "%s"', async (state, expectedCmd) => {
    const executeCommand = jest.fn().mockResolvedValue('');
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand,
      close: jest.fn(),
    });

    const result = await driver.setOnuAdminState(
      { host: '172.16.100.5', port: 2324, username: 'admin', password: 'admin' },
      'epon 1/1:2',
      state as 'ACTIVE' | 'BLOCKED',
    );

    expect(result.ok).toBe(true);
    expect(executeCommand).toHaveBeenCalledWith(expectedCmd);
  });

  it('deleteOnu() usa "delete onu <id>" (confirmado) y no "dereg" (confirmado que falla en este equipo)', async () => {
    const executeCommand = jest.fn().mockResolvedValue('');
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand,
      close: jest.fn(),
    });

    const result = await driver.deleteOnu(
      { host: '172.16.100.5', port: 2324, username: 'admin', password: 'admin' },
      'epon 1/1',
      5,
    );

    expect(result.ok).toBe(true);
    expect(executeCommand).toHaveBeenCalledWith('delete onu 5');
    expect(executeCommand).not.toHaveBeenCalledWith(expect.stringContaining('dereg'));
  });
});
