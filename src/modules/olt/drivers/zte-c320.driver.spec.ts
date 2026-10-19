import { ZteC320Driver, ZteTelnetSession } from './zte-c320.driver';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

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

    // Sale de "pon-onu-mng" con "end", NUNCA con "exit" -- con "exit" la OLT
    // real pregunta "Confirm to logout without saving? [yes/no]:" y la
    // sesión se cuelga (bug real en producción, 2026-10-19, ver también los
    // ejemplos del manual ZXA10 C300 §2.11-2.13, todos usan "end" ahí).
    const tr069MgmtIdx = commands.indexOf('tr069-mgmt 1 acs http://10.46.0.1:7547/ tag pri 2 vlan 46');
    expect(commands[tr069MgmtIdx + 1]).toBe('end');
  });

  it('genera "traffic-profile <nombre> vport 1 direction egress" (bajada) solo si config.trafficProfile está presente', () => {
    const withTraffic = driver.generateAuthorizationScript({
      ponInterface: 'gpon-olt_1/1/1',
      onuId: 5,
      modelTypeName: 'ZTE-F660',
      serialNumber: 'ZTEGC0123456',
      serviceVlan: 200,
      trafficProfile: 'TRAFFIC-50M',
      managementMethod: 'OMCI',
      operationMode: 'ROUTER',
    });
    expect(withTraffic).toContain('traffic-profile TRAFFIC-50M vport 1 direction egress');

    const withoutTraffic = driver.generateAuthorizationScript({
      ponInterface: 'gpon-olt_1/1/1',
      onuId: 5,
      modelTypeName: 'ZTE-F660',
      serialNumber: 'ZTEGC0123456',
      serviceVlan: 200,
      managementMethod: 'OMCI',
      operationMode: 'ROUTER',
    });
    expect(withoutTraffic.some((c) => c.startsWith('traffic-profile'))).toBe(false);
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

  it('discoverInterfaces() detecta el slot/puertos GPON reales -- no cae al fallback hardcodeado (bug real: Tarjetas Rack/Shelf/Slot desalineadas)', async () => {
    const fixturesDir = path.join(__dirname, '../../../../test/fixtures/zte-c320');
    const cardList = fs.readFileSync(path.join(fixturesDir, 'show_card_tabara_abajo.txt'), 'utf8');

    // La tarjeta GPON real de este chasis es slot 2 (GTGH, 16 puertos) -- NO
    // el slot 1/GTGO/8-puertos del fallback. Devolvemos un "show interface"
    // sintético solo para satisfacer el parseo posterior (adminState/operState),
    // no es una captura real -- lo que se está probando es que el método
    // consulta el slot/puerto correcto, no el formato exacto de esa salida.
    const executeCommand = jest.fn().mockImplementation((cmd: string) => {
      if (cmd === 'show card') return Promise.resolve(cardList);
      if (cmd.startsWith('show interface gpon-olt_1/2/')) {
        return Promise.resolve('gpon-olt_1/2/1 is up, line protocol is up\nNumber of registered onus is 3\nInput rate: 1000 Bps\nOutput rate: 2000 Bps');
      }
      return Promise.resolve('Invalid input');
    });

    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand,
      close: jest.fn(),
    });

    const result = await driver.discoverInterfaces({
      host: '10.0.0.10',
      port: 23,
      username: 'admin',
      password: 'password',
    });

    const ponInterfaces = result.filter((i) => i.type === 'PON');
    expect(ponInterfaces).toHaveLength(16); // portCount real de la tarjeta GTGH, no el fallback de 8
    expect(ponInterfaces[0].name).toBe('gpon-olt_1/2/1');
    expect(ponInterfaces[0].slot).toBe(2);
    expect(ponInterfaces[0].registeredOnus).toBe(3);

    // Nunca debió consultar el slot 1 (fallback) -- la tarjeta GPON real está en el slot 2
    expect(executeCommand).not.toHaveBeenCalledWith('show interface gpon-olt_1/1/1', expect.anything());
  });

  it('discoverInterfaces() descubre uplinks GEI reales en vez del bloque hardcodeado (bug real: gei_1/3 fijo no existe en este chasis)', async () => {
    const fixturesDir = path.join(__dirname, '../../../../test/fixtures/zte-c320');
    const cardList = fs.readFileSync(path.join(fixturesDir, 'show_card_tabara_abajo.txt'), 'utf8');
    const geiUp = fs.readFileSync(path.join(fixturesDir, 'show_interface_gei_1_4_1_up.txt'), 'utf8');
    const geiDown = fs.readFileSync(path.join(fixturesDir, 'show_interface_gei_1_4_3_down.txt'), 'utf8');
    const geiInvalid = '\n                                       ^\n%Error 20202: Invalid input detected at \'^\' marker.Invalid parameter\n';

    const executeCommand = jest.fn().mockImplementation((cmd: string) => {
      if (cmd === 'show card') return Promise.resolve(cardList);
      if (cmd === 'show interface gei_1/4/1') return Promise.resolve(geiUp);
      if (cmd === 'show interface gei_1/4/3') return Promise.resolve(geiDown);
      // slot 3 (PRAM) y el resto de puertos de slot 4 no existen en este chasis real
      return Promise.resolve(geiInvalid);
    });

    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand,
      close: jest.fn(),
    });

    const result = await driver.discoverInterfaces({
      host: '10.0.0.10',
      port: 23,
      username: 'admin',
      password: 'password',
    });

    const uplinks = result.filter((i) => i.type === 'UPLINK');
    expect(uplinks).toHaveLength(2); // solo los puertos 1 y 3 existen de verdad -- el 2 no
    expect(uplinks.map((u) => u.name).sort()).toEqual(['gei_1/4/1', 'gei_1/4/3']);

    const portUp = uplinks.find((u) => u.name === 'gei_1/4/1')!;
    expect(portUp.slot).toBe(4);
    expect(portUp.adminState).toBe('UP');
    expect(portUp.operState).toBe('UP');

    const portDown = uplinks.find((u) => u.name === 'gei_1/4/3')!;
    expect(portDown.adminState).toBe('DOWN');
    expect(portDown.operState).toBe('DOWN');

    // Nunca debió reportar el bloque hardcodeado del slot 3 (PRAM no tiene interfaces GEI reales)
    expect(uplinks.some((u) => u.slot === 3)).toBe(false);
  });

  it('getAuthorizedOnus() importa ONUs ya autorizadas con serial real desde "show gpon onu baseinfo" + estado desde "show gpon onu state" (RF: brownfield)', async () => {
    const fixturesDir = path.join(__dirname, '../../../../test/fixtures/zte-c320');
    const baseInfo = fs.readFileSync(path.join(fixturesDir, 'show_gpon_onu_baseinfo.txt'), 'utf8');
    const stateInfo = fs.readFileSync(path.join(fixturesDir, 'show_gpon_onu_state.txt'), 'utf8');

    const executeCommand = jest.fn().mockImplementation((cmd: string) => {
      if (cmd === 'show gpon onu baseinfo gpon-olt_1/2/1') return Promise.resolve(baseInfo);
      if (cmd === 'show gpon onu state gpon-olt_1/2/1') return Promise.resolve(stateInfo);
      throw new Error(`comando inesperado: ${cmd}`);
    });

    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand,
      close: jest.fn(),
    });

    const result = await driver.getAuthorizedOnus(
      { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
      'gpon-olt_1/2/1',
    );

    expect(result).toHaveLength(4);

    const onu1 = result.find((r) => r.onuIndex === 'gpon-onu_1/2/1:1')!;
    expect(onu1.serialNumber).toBe('HWTC5F4A209A');
    expect(onu1.vendor).toBe('Huawei');
    expect(onu1.adminState).toBe('ENABLE');
    expect(onu1.phaseState).toBe('OffLine');

    const onu3 = result.find((r) => r.onuIndex === 'gpon-onu_1/2/1:3')!;
    expect(onu3.serialNumber).toBe('RMTGCB52DE3A');
    expect(onu3.vendor).toBe('Desconocido'); // prefijo no reconocido -- no se inventa un fabricante
    expect(onu3.adminState).toBe('DISABLE'); // deshabilitada por el otro sistema

    const onu2 = result.find((r) => r.onuIndex === 'gpon-onu_1/2/1:2')!;
    expect(onu2.phaseState).toBe('working');
  });

  it('getAuthorizedOnus() lanza error si la OLT no reconoce el puerto PON', async () => {
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand: jest.fn().mockResolvedValue('\n   ^\n%Error 20202: Invalid input detected at \'^\' marker.Invalid parameter\n'),
      close: jest.fn(),
    });

    await expect(
      driver.getAuthorizedOnus({ host: '10.0.0.10', port: 23, username: 'admin', password: 'password' }, 'gpon-olt_1/9/9'),
    ).rejects.toThrow('no reconoce el puerto PON');
  });

  it('getVlanConfigForInterface() expande rangos con guión en la lista de VLANs reales (RF: brownfield -- confirmado en vivo contra OLT_Tabara_Abajo)', async () => {
    const fixturePath = path.join(__dirname, '../../../../test/fixtures/zte-c320/show_vlan_port_uplink_tagged.txt');
    const fixtureContent = fs.readFileSync(fixturePath, 'utf8');

    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand: jest.fn().mockResolvedValue(fixtureContent),
      close: jest.fn(),
    });

    const result = await driver.getVlanConfigForInterface(
      { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
      'gei_1/4/1',
    );

    // "1,46,400-405,700" -- el rango 400-405 debe expandirse completo, no
    // interpretarse como un solo valor "400" perdiendo 401-404 en silencio.
    expect(result).toEqual([
      { vlanId: 1, mode: 'TAG' },
      { vlanId: 46, mode: 'TAG' },
      { vlanId: 400, mode: 'TAG' },
      { vlanId: 401, mode: 'TAG' },
      { vlanId: 402, mode: 'TAG' },
      { vlanId: 403, mode: 'TAG' },
      { vlanId: 404, mode: 'TAG' },
      { vlanId: 405, mode: 'TAG' },
      { vlanId: 700, mode: 'TAG' },
    ]);
  });

  it('getVlanConfigForInterface() devuelve lista vacía para un puerto PON sin VLANs trunk (modo access real)', async () => {
    const fixturePath = path.join(__dirname, '../../../../test/fixtures/zte-c320/show_vlan_port_pon_empty.txt');
    const fixtureContent = fs.readFileSync(fixturePath, 'utf8');

    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand: jest.fn().mockResolvedValue(fixtureContent),
      close: jest.fn(),
    });

    const result = await driver.getVlanConfigForInterface(
      { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
      'gpon-olt_1/2/1',
    );

    expect(result).toEqual([]);
  });

  it('getVlanConfigForInterface() lanza error si la OLT rechaza la interfaz', async () => {
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand: jest.fn().mockResolvedValue('%Error 20202: Invalid input detected'),
      close: jest.fn(),
    });

    await expect(
      driver.getVlanConfigForInterface({ host: '10.0.0.10', port: 23, username: 'admin', password: 'password' }, 'gei_9/9/9'),
    ).rejects.toThrow('rechazó la interfaz');
  });

  it('getTcontProfiles() parsea perfiles TCONT reales de los 5 tipos documentados, usando max(FBW,ABW,MBW) como velocidad (RF: brownfield -- confirmado en vivo contra OLT_Tabara_Abajo)', async () => {
    const fixturePath = path.join(__dirname, '../../../../test/fixtures/zte-c320/show_gpon_profile_tcont.txt');
    const fixtureContent = fs.readFileSync(fixturePath, 'utf8');

    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand: jest.fn().mockResolvedValue(fixtureContent),
      close: jest.fn(),
    });

    const result = await driver.getTcontProfiles({ host: '10.0.0.10', port: 23, username: 'admin', password: 'password' });

    expect(result).toEqual([
      { name: 'default', type: 1, fbwKbps: 10000, abwKbps: 0, mbwKbps: 0, speedKbps: 10000 },
      { name: 'voip', type: 2, fbwKbps: 0, abwKbps: 2048, mbwKbps: 0, speedKbps: 2048 },
      { name: 'internet', type: 4, fbwKbps: 0, abwKbps: 0, mbwKbps: 100240, speedKbps: 100240 },
      { name: 'SMARTOLT-VOIPMNG-10M', type: 5, fbwKbps: 512, abwKbps: 1024, mbwKbps: 11264, speedKbps: 11264 },
      { name: 'SMARTOLT-100M-UP', type: 5, fbwKbps: 64, abwKbps: 64, mbwKbps: 110080, speedKbps: 110080 },
    ]);
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

  it('lee CPU/memoria/uptime/temperatura reales -- recorre tarjetas EN SERVICIO hasta encontrar la que trae CPU (RF-OLT-005)', async () => {
    const fixturesDir = path.join(__dirname, '../../../../test/fixtures/zte-c320');
    const cardList = fs.readFileSync(path.join(fixturesDir, 'show_card_tabara_abajo.txt'), 'utf8');
    const pramDetail = fs.readFileSync(path.join(fixturesDir, 'show_card_slotno_pram_no_cpu.txt'), 'utf8');
    const smxaDetail = fs.readFileSync(path.join(fixturesDir, 'show_card_slotno_smxa_control.txt'), 'utf8');
    const fanOutput = fs.readFileSync(path.join(fixturesDir, 'show_fan.txt'), 'utf8');

    const executeCommand = jest.fn().mockImplementation((cmd: string) => {
      if (cmd === 'show card') return Promise.resolve(cardList);
      if (cmd === 'show card slotno 2') return Promise.resolve(pramDetail); // GTGH: sin Cpu-Usage tampoco, misma forma vacia
      if (cmd === 'show card slotno 3') return Promise.resolve(pramDetail);
      if (cmd === 'show card slotno 4') return Promise.resolve(smxaDetail);
      if (cmd === 'show fan') return Promise.resolve(fanOutput);
      throw new Error(`comando inesperado en el test: ${cmd}`);
    });

    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand,
      close: jest.fn(),
    });

    const result = await driver.getSystemHealth({
      host: '10.0.0.10',
      port: 23,
      username: 'admin',
      password: 'password',
    });

    expect(result.cpuUsagePercent).toBe(9);
    expect(result.memoryUsagePercent).toBe(26);
    expect(result.temperatureCelsius).toBe(36);
    // 122 dias, 3 horas, 37 minutos, 13 segundos
    expect(result.uptimeSeconds).toBe(122 * 86400 + 3 * 3600 + 37 * 60 + 13);

    // Se detuvo en el primer slot con CPU real (4): no debió consultar mas alla
    expect(executeCommand).toHaveBeenCalledWith('show card slotno 4');
    expect(executeCommand).not.toHaveBeenCalledWith('show card slotno 5');
  });

  it('reporta campos undefined (no inventa datos) si ninguna tarjeta trae Cpu-Usage real', async () => {
    const fixturesDir = path.join(__dirname, '../../../../test/fixtures/zte-c320');
    const cardList = fs.readFileSync(path.join(fixturesDir, 'show_card_tabara_abajo.txt'), 'utf8');
    const pramDetail = fs.readFileSync(path.join(fixturesDir, 'show_card_slotno_pram_no_cpu.txt'), 'utf8');
    const fanOutput = fs.readFileSync(path.join(fixturesDir, 'show_fan.txt'), 'utf8');

    // Todas las tarjetas devuelven el mismo detalle sin CPU -- simula un
    // chasis donde ninguna tarjeta reporta Cpu-Usage (nunca inventar un valor).
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
      connectAndLogin: jest.fn().mockResolvedValue(undefined),
      executeCommand: jest.fn().mockImplementation((cmd: string) =>
        cmd === 'show card' ? Promise.resolve(cardList) : cmd === 'show fan' ? Promise.resolve(fanOutput) : Promise.resolve(pramDetail),
      ),
      close: jest.fn(),
    });

    const result = await driver.getSystemHealth({
      host: '10.0.0.10',
      port: 23,
      username: 'admin',
      password: 'password',
    });

    expect(result.cpuUsagePercent).toBeUndefined();
    expect(result.memoryUsagePercent).toBeUndefined();
    expect(result.uptimeSeconds).toBeUndefined();
    // La temperatura es independiente de las tarjetas -- sigue viniendo de "show fan"
    expect(result.temperatureCelsius).toBe(36);
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

  describe('findTcontProfileByName / ensureTcontProfile (confirmado en vivo contra OLT_Tabara_Abajo, 2026-10-19)', () => {
    const fixturePath = path.join(__dirname, '../../../../test/fixtures/zte-c320/show_gpon_profile_tcont.txt');
    const fixtureContent = fs.readFileSync(fixturePath, 'utf8');

    it('findTcontProfileByName devuelve null si el nombre no aparece en "show gpon profile tcont"', async () => {
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand: jest.fn().mockResolvedValue(fixtureContent),
        close: jest.fn(),
      });

      const result = await driver.findTcontProfileByName(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        'NO-EXISTE',
      );

      expect(result).toBeNull();
    });

    it('findTcontProfileByName encuentra el perfil real y usa max(FBW,ABW,MBW) como fixedKbps', async () => {
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand: jest.fn().mockResolvedValue(fixtureContent),
        close: jest.fn(),
      });

      const result = await driver.findTcontProfileByName(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        'SMARTOLT-100M-UP',
      );

      expect(result).toEqual({ name: 'SMARTOLT-100M-UP', fixedKbps: 110080 });
    });

    it('ensureTcontProfile crea el perfil entrando a "configure terminal"/"gpon" y usando "type 5 fixed 64 assured 64 maximum <kbps>" si no existe', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === 'show gpon profile tcont') return Promise.resolve('');
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.ensureTcontProfile(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { name: 'SUMTECH-NUEVO-5M', fixedKbps: 5000 },
      );

      expect(result.ok).toBe(true);
      expect(executeCommand.mock.calls.map((c: any[]) => c[0])).toEqual([
        'show gpon profile tcont',
        'configure terminal',
        'gpon',
        'profile tcont SUMTECH-NUEVO-5M type 5 fixed 64 assured 64 maximum 5000',
        'exit',
        'exit',
        'write',
      ]);
    });

    it('ensureTcontProfile es idempotente: no vuelve a crear si el perfil ya existe', async () => {
      const executeCommand = jest.fn().mockResolvedValue(fixtureContent);
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.ensureTcontProfile(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { name: 'SMARTOLT-100M-UP', fixedKbps: 110080 },
      );

      expect(result.ok).toBe(true);
      expect(executeCommand).toHaveBeenCalledTimes(1);
      expect(executeCommand).not.toHaveBeenCalledWith('configure terminal');
    });
  });

  describe('ensureTrafficProfile (bajada/downstream, confirmado en vivo contra OLT_Tabara_Abajo, 2026-10-19)', () => {
    it('ensureTrafficProfile declara el perfil con "configure terminal"/"traffic-profile ... ip cir <kbps> cbs 1000 pir <kbps> pbs 1000"/"exit"/"write", sin chequeo de existencia previo', async () => {
      const executeCommand = jest.fn().mockResolvedValue('');
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.ensureTrafficProfile(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { name: 'TRAFFIC-NUEVO-5M', downKbps: 5000 },
      );

      expect(result.ok).toBe(true);
      expect(executeCommand.mock.calls.map((c: any[]) => c[0])).toEqual([
        'configure terminal',
        'traffic-profile TRAFFIC-NUEVO-5M ip cir 5000 cbs 1000 pir 5000 pbs 1000',
        'exit',
        'write',
      ]);
    });

    it('redeclarar un perfil que ya existe es en sí mismo idempotente (confirmado en vivo: sin error al repetir el mismo comando)', async () => {
      const executeCommand = jest.fn().mockResolvedValue('');
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.ensureTrafficProfile(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { name: 'TRAFFIC-50M', downKbps: 51200 },
      );

      expect(result.ok).toBe(true);
      expect(executeCommand).toHaveBeenCalledWith(
        'traffic-profile TRAFFIC-50M ip cir 51200 cbs 1000 pir 51200 pbs 1000',
      );
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
      expect(calledCommands.indexOf('profile tcont FIXED5M type 5 fixed 64 assured 64 maximum 5000')).toBeGreaterThan(
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

    it('asegura también el traffic-profile de bajada cuando hay trafficProfile + downKbps', async () => {
      const executeCommand = jest.fn().mockResolvedValue('');
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
          trafficProfile: 'TRAFFIC5M',
          downKbps: 5000,
          managementMethod: 'OMCI',
          operationMode: 'ROUTER',
        },
      );

      expect(result.ok).toBe(true);
      expect(executeCommand).toHaveBeenCalledWith('traffic-profile TRAFFIC5M ip cir 5000 cbs 1000 pir 5000 pbs 1000');
    });

    it('no intenta asegurar ningún traffic-profile si no se provee trafficProfile/downKbps', async () => {
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

      expect(executeCommand).not.toHaveBeenCalledWith(expect.stringContaining('traffic-profile'));
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

  it('getAlarms() sigue señalando DRIVER_NOT_IMPLEMENTED: sin reconocimiento real de un comando de log para C320 todavía', async () => {
    await expect(
      driver.getAlarms({ host: '10.0.0.10', port: 23, username: 'admin', password: 'password' }),
    ).rejects.toThrow('no está implementada');
    expect(driver.getCapabilities().alarms).toBe(false);
  });

  it('tr069AutoProvisioning se mantiene en false pese a tener código real (mismo criterio que vlanTranslation), con nota que lo distingue de "no implementado"', () => {
    expect(driver.getCapabilities().tr069AutoProvisioning).toBe(false);
    expect(driver.getCapabilityNotes().tr069AutoProvisioning).toMatch(/tr069-mgmt/i);
  });

  it('dbaProfile (TCONT) ya está en true -- confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19)', () => {
    expect(driver.getCapabilities().dbaProfile).toBe(true);
  });

  it('downstreamTrafficProfile ya está en true -- confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19)', () => {
    expect(driver.getCapabilities().downstreamTrafficProfile).toBe(true);
  });
});

describe('ZteTelnetSession.executeCommand() -- bug real de producción (2026-10-17)', () => {
  // Fake socket mínimo: EventEmitter + write(), igual a la interfaz que
  // net.Socket expone y que executeCommand() consume.
  function createFakeSocket() {
    const emitter = new EventEmitter() as EventEmitter & { write: jest.Mock; removeListener: any };
    emitter.write = jest.fn();
    return emitter;
  }

  it('resuelve aunque el "--More--" final y el prompt de retorno lleguen en el MISMO chunk (la OLT no siempre espera la tecla de avance)', async () => {
    const session = new ZteTelnetSession({ host: '10.0.0.10', port: 23, username: 'admin', password: 'password' });
    const fakeSocket = createFakeSocket();
    (session as any).socket = fakeSocket;

    // Reproduce exactamente el log real: 3 páginas "--More--" seguidas del
    // contenido final + el prompt, todo en una sola emisión de 'data' (tal
    // como ocurrió contra OLT_Tabara_Abajo, puerto 1/2/5).
    const finalChunk =
      'gpon-onu_1/2/5:40   HUAWEY-BT54 sn      SN:HWTC469FB39E         ready\r\n' +
      '                    6XG                                         \r\n' +
      '--More--' +
      ' \b \b\b \b\b \b\b \b\b \b\b \b\b \b\b \b\b \bOLT-TABARA-ABAJO#';

    const promise = session.executeCommand('show gpon onu baseinfo gpon-olt_1/2/5', 5000);

    fakeSocket.emit('data', Buffer.from('gpon-onu_1/2/5:1 ... ready\r\n--More--'));
    fakeSocket.emit('data', Buffer.from(finalChunk));

    const result = await promise;

    expect(result).toContain('HWTC469FB39E');
    // La corrección clave: NO debe quedar colgado esperando un chunk que
    // nunca llega porque la OLT ya mandó todo (incluido el prompt).
  });

  it('sigue funcionando en el caso normal: "--More--" en un chunk, contenido+prompt en el siguiente', async () => {
    const session = new ZteTelnetSession({ host: '10.0.0.10', port: 23, username: 'admin', password: 'password' });
    const fakeSocket = createFakeSocket();
    (session as any).socket = fakeSocket;

    const promise = session.executeCommand('show card', 5000);

    fakeSocket.emit('data', Buffer.from('Rack Shelf Slot ...\r\n--More--'));
    fakeSocket.emit('data', Buffer.from('Rack Shelf Slot resto...\r\nOLT-TABARA-ABAJO#'));

    const result = await promise;

    expect(result).toContain('resto');
    expect(fakeSocket.write).toHaveBeenCalledWith(' ');
  });

  it('falla de inmediato (sin esperar el timeout completo) si la OLT pide una confirmación interactiva inesperada', async () => {
    const session = new ZteTelnetSession({ host: '10.0.0.10', port: 23, username: 'admin', password: 'password' });
    const fakeSocket = createFakeSocket();
    (session as any).socket = fakeSocket;

    // Reproduce el bug real: "exit" en vez de "end" al salir de
    // "pon-onu-mng" dispara esta pregunta, que el driver no puede responder
    // genéricamente (la OLT quedaría pendiente del yes/no para siempre).
    const promise = session.executeCommand('exit', 20000);

    fakeSocket.emit(
      'data',
      Buffer.from('\r\nThe configuration is changed,confirm to logout without saving? [yes/no]:'),
    );

    await expect(promise).rejects.toThrow(/confirmación interactiva/i);
  });
});
