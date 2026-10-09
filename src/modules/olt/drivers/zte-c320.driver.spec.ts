import { ZteC320Driver } from './zte-c320.driver';
import * as fs from 'fs';
import * as path from 'path';

describe('ZteC320Driver', () => {
  let driver: ZteC320Driver;

  beforeEach(() => {
    driver = new ZteC320Driver();
  });

  it('debe estar definido', () => {
    expect(driver).toBeDefined();
  });

  it('devuelve ok:false con mensaje legible si el host OLT no es alcanzable', async () => {
    const result = await driver.testConnection({
      host: '192.0.2.1', // Test net ip no alcanzable
      port: 23,
      username: 'admin',
      password: 'wrong',
      timeoutMs: 300,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('genera correctamente los comandos CLI de autorización y provisión (RF-OLT-016 / RF-OLT-018)', () => {
    const commands = driver.generateAuthorizationScript({
      ponInterface: 'gpon-olt_1/1/1',
      onuId: 5,
      modelTypeName: 'ZTE-F660',
      serialNumber: 'ZTEGC0123456',
      clientName: 'CLI-001-JuanPerez',
      serviceVlan: 200,
      tr069Vlan: 46,
      tr069Url: 'http://10.46.0.1:7547/',
      tcontProfile: 'UP-50M',
      managementMethod: 'TR069',
      operationMode: 'ROUTER',
    });

    expect(commands).toContain('configure terminal');
    expect(commands).toContain('interface gpon-olt_1/1/1');
    expect(commands).toContain('onu 5 type ZTE-F660 sn ZTEGC0123456');
    expect(commands).toContain('interface gpon-olt_1/1/1:5');
    expect(commands).toContain('name CLI-001-JuanPerez');
    expect(commands).toContain('tcont 1 profile UP-50M');
    expect(commands).toContain('gemport 1 tcont 1');
    expect(commands).toContain('service-port 1 vport 1 user-vlan 200 vlan 200');
    expect(commands).toContain('pon-onu-mng gpon-olt_1/1/1:5');
    expect(commands).toContain('tr069-mgmt 1 acs http://10.46.0.1:7547/ tag pri 2 vlan 46');
    expect(commands).toContain('write');
  });

  it('parsea correctamente las ONUs no configuradas y extrae serial y fabricante (RF-OLT-014)', async () => {
    const fixturePath = path.join(__dirname, '../../../../test/fixtures/zte-c320/show_gpon_onu_uncfg.txt');
    const fixtureContent = fs.readFileSync(fixturePath, 'utf8');

    // Hacemos mock de createSession para devolver el fixture en executeCommand
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand: jest.fn().mockResolvedValue(fixtureContent),
      close: jest.fn(),
    });

    const result = await driver.getUnconfiguredOnus({
      host: '10.0.0.10',
      port: 23,
      username: 'admin',
      password: 'password',
    });

    expect(result).toHaveLength(2);
    expect(result[0].onuIndex).toBe('gpon-onu_1/1/1:1');
    expect(result[0].serialNumber).toBe('ZTEGC0123456');
    expect(result[0].vendor).toBe('ZTE');
    expect(result[0].ponInterface).toBe('gpon-olt_1/1/1');

    expect(result[1].onuIndex).toBe('gpon-onu_1/1/1:2');
    expect(result[1].serialNumber).toBe('HWTCA9876543');
    expect(result[1].vendor).toBe('Huawei');
  });

  it('parsea correctamente el inventario de tarjetas del chasis (show card)', async () => {
    const fixturePath = path.join(__dirname, '../../../../test/fixtures/zte-c320/show_card.txt');
    const fixtureContent = fs.readFileSync(fixturePath, 'utf8');

    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand: jest.fn().mockResolvedValue(fixtureContent),
      close: jest.fn(),
    });

    const result = await driver.getCards({
      host: '10.0.0.10',
      port: 23,
      username: 'admin',
      password: 'password',
    });

    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({
      slot: 1,
      cardType: 'GTGH',
      realType: 'GTGH',
      portCount: 16,
      hardVer: 'V1.2.0',
      softVer: 'V2.1.0',
      status: 'INSERVICE',
    });
    expect(result[3].status).toBe('STANDBY');
    expect(result[4].portCount).toBe(1);
  });

  it('getSystemHealth() sigue señalando DRIVER_NOT_IMPLEMENTED: sin evidencia real de CPU/memoria/temperatura', async () => {
    await expect(
      driver.getSystemHealth({ host: '10.0.0.10', port: 23, username: 'admin', password: 'password' }),
    ).rejects.toThrow('no está implementada');
  });

  it('parsea correctamente la telemetría de potencia óptica en dBm (RF-OLT-015)', async () => {
    const fixturePath = path.join(__dirname, '../../../../test/fixtures/zte-c320/show_pon_power_attenuation.txt');
    const fixtureContent = fs.readFileSync(fixturePath, 'utf8');

    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand: jest.fn().mockResolvedValue(fixtureContent),
      close: jest.fn(),
    });

    const result = await driver.getOnuOpticalPower(
      { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
      'gpon-onu_1/1/1:1',
    );

    expect(result.upRxDbm).toBe(-21.45);
    expect(result.txDbm).toBe(2.50);
    expect(result.downRxDbm).toBe(-19.80);
    expect(result.rxDbm).toBe(-19.80); // Potencia recibida en la ONU
    expect(result.attenuationDb).toBe(23.60);
  });

  it.each([
    ['DOWN', 'shutdown'],
    ['UP', 'no shutdown'],
  ])('setInterfaceAdminState(%s) usa "%s" sobre la interfaz física (puerto PON/uplink, no un ONU)', async (state, expectedCmd) => {
    const executeCommand = jest.fn().mockResolvedValue('');
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand,
      close: jest.fn(),
    });

    const result = await driver.setInterfaceAdminState(
      { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
      'gpon-olt_1/1/1',
      state as 'UP' | 'DOWN',
    );

    expect(result.ok).toBe(true);
    expect(executeCommand).toHaveBeenCalledWith('interface gpon-olt_1/1/1');
    expect(executeCommand).toHaveBeenCalledWith(expectedCmd);
  });

  it('setInterfaceAdminState() responde ok:false si el equipo rechaza el comando', async () => {
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand: jest.fn().mockRejectedValue(new Error('% Invalid input')),
      close: jest.fn(),
    });

    const result = await driver.setInterfaceAdminState(
      { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
      'gpon-olt_1/1/1',
      'DOWN',
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('% Invalid input');
  });

  describe('findTcontProfileByName / ensureTcontProfile (sintaxis documentada públicamente, no verificada en vivo)', () => {
    it('findTcontProfileByName devuelve null si el nombre no aparece en "show gpon profile tcont"', async () => {
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand: jest.fn().mockResolvedValue('PROFILE NAME   TYPE   FIXED\nOTHER5M        1      5000'),
        close: jest.fn(),
      });

      const result = await driver.findTcontProfileByName(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        'FIXED5M',
      );

      expect(result).toBeNull();
    });

    it('findTcontProfileByName encuentra el perfil y extrae el valor fixed cercano', async () => {
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand: jest.fn().mockResolvedValue('PROFILE NAME   TYPE   FIXED\nFIXED5M        1      fixed 5000'),
        close: jest.fn(),
      });

      const result = await driver.findTcontProfileByName(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        'FIXED5M',
      );

      expect(result).toEqual({ name: 'FIXED5M', fixedKbps: 5000 });
    });

    it('ensureTcontProfile crea el perfil con "profile tcont <nombre> type 1 fixed <kbps>" si no existe', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === 'show gpon profile tcont') return Promise.resolve('PROFILE NAME   TYPE   FIXED');
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.ensureTcontProfile(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { name: 'FIXED5M', fixedKbps: 5000 },
      );

      expect(result.ok).toBe(true);
      expect(executeCommand).toHaveBeenCalledWith('profile tcont FIXED5M type 1 fixed 5000');
    });

    it('ensureTcontProfile es idempotente: no vuelve a crear si el perfil ya existe', async () => {
      const executeCommand = jest.fn().mockResolvedValue('PROFILE NAME   TYPE   FIXED\nFIXED5M  1  fixed 5000');
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      await driver.ensureTcontProfile(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { name: 'FIXED5M', fixedKbps: 5000 },
      );

      expect(executeCommand).not.toHaveBeenCalledWith(expect.stringContaining('profile tcont FIXED5M type'));
    });
  });

  describe('authorizeOnu() + TCONT', () => {
    it('asegura el perfil TCONT antes de correr el script de autorización cuando hay tcontProfile + upKbps', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === 'show gpon profile tcont') return Promise.resolve('PROFILE NAME   TYPE   FIXED');
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.authorizeOnu(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        {
          ponInterface: 'gpon-olt_1/1/1',
          onuId: 1,
          modelTypeName: 'ZTE-F660',
          serialNumber: 'ZTEGC0123456',
          serviceVlan: 400,
          tcontProfile: 'FIXED5M',
          upKbps: 5000,
          managementMethod: 'OMCI',
          operationMode: 'ROUTER',
        },
      );

      expect(result.ok).toBe(true);
      const calledCommands = executeCommand.mock.calls.map((c) => c[0]);
      expect(calledCommands.indexOf('show gpon profile tcont')).toBeGreaterThanOrEqual(0);
      expect(calledCommands.indexOf('profile tcont FIXED5M type 1 fixed 5000')).toBeGreaterThan(
        calledCommands.indexOf('show gpon profile tcont'),
      );
    });

    it('no intenta asegurar ningún perfil TCONT si no se provee tcontProfile/upKbps', async () => {
      const executeCommand = jest.fn().mockResolvedValue('');
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      await driver.authorizeOnu(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        {
          ponInterface: 'gpon-olt_1/1/1',
          onuId: 1,
          modelTypeName: 'ZTE-F660',
          serialNumber: 'ZTEGC0123456',
          serviceVlan: 400,
          managementMethod: 'OMCI',
          operationMode: 'ROUTER',
        },
      );

      expect(executeCommand).not.toHaveBeenCalledWith('show gpon profile tcont');
    });
  });

  it('configureVlanTranslation() sigue señalando DRIVER_NOT_IMPLEMENTED: solo se confirmó el nombre del comando, no la sintaxis completa', async () => {
    const result = await driver.configureVlanTranslation(
      { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
      { interfaceName: 'gpon-olt_1/1/1', customerVlanId: 100, networkVlanId: 400 },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('no está implementada');
  });
});
