import { ZteC320Driver, ZteTelnetSession, REBOOT_ONU_SENTINEL } from './zte-c320.driver';
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

  it('genera correctamente los comandos CLI de autorización y provisión, incluido TODO el bloque TR-069/ACS en la misma sesión atómica (canal de internet + canal de gestión) -- CONFIRMADO EN VIVO (2026-10-24, ONU CMDCDD4D131E) que dividir esto en 2 sesiones Telnet separadas dejaba gemport 2 sin existir cuando pon-onu-mng intentaba enlazar "flow 2" a él, causa raíz real de que la ONU no obtuviera IP de gestión ni contactara GenieACS', () => {
    const commands = driver.generateAuthorizationScript({
      ponInterface: 'gpon-olt_1/1/1',
      onuId: 5,
      modelTypeName: 'ZTE-F660',
      serialNumber: 'ZTEGC0123456',
      clientName: 'CLI-001-JuanPerez',
      description: 'zone_Tabara Abajo_lat_18.65_long_-71.03_authd_20261020',
      serviceVlan: 200,
      tr069Vlan: 46,
      tr069Url: 'http://10.46.0.1:7547/',
      tcontProfile: 'UP-50M',
      managementMethod: 'TR069',
      operationMode: 'ROUTER',
    });

    expect(commands).toContain('configure terminal');
    expect(commands).toContain('interface gpon-olt_1/1/1');
    // "no onu 5" ANTES de crearla -- confirmado en vivo (2026-10-23) que
    // autorizar sobre un registro parcial/corrupto de un intento anterior
    // causaba rechazos intermitentes o un bloque OMCI incompleto sin ningún
    // error visible. Debe ir justo antes de "onu <id> type ... sn ...".
    const noOnuIdx = commands.indexOf('no onu 5');
    const createOnuIdx = commands.indexOf('onu 5 type ZTE-F660 sn ZTEGC0123456');
    expect(noOnuIdx).toBeGreaterThanOrEqual(0);
    expect(createOnuIdx).toBeGreaterThan(noOnuIdx);
    expect(commands).toContain('onu 5 type ZTE-F660 sn ZTEGC0123456');
    // La sub-interfaz lógica de la ONU usa el prefijo "gpon-onu_", DISTINTO
    // del puerto físico "gpon-olt_" -- bug real confirmado en vivo contra
    // OLT_Tabara_Abajo (2026-10-20), ver toOnuInterfaceName().
    expect(commands).toContain('interface gpon-onu_1/1/1:5');
    expect(commands).toContain('name CLI-001-JuanPerez');
    // "description" se sanea igual que "name" (espacios -> "_") por el mismo
    // patrón de bug real ya documentado para "onu-type ... description".
    expect(commands).toContain('description zone_Tabara_Abajo_lat_18.65_long_-71.03_authd_20261020');
    const nameIdx = commands.indexOf('name CLI-001-JuanPerez');
    expect(commands[nameIdx + 1]).toBe('description zone_Tabara_Abajo_lat_18.65_long_-71.03_authd_20261020');
    expect(commands).toContain('tcont 1 profile UP-50M');
    expect(commands).toContain('gemport 1 tcont 1');
    // CONFIRMADO EN VIVO contra OLT_Tabara_Abajo (2026-10-24, ONU
    // CMDCDD4D131E): techo genérico de GEM port del canal de Internet, mismo
    // patrón que "gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M"
    // del canal de gestión -- faltaba su equivalente acá.
    expect(commands).toContain('gemport 1 traffic-limit downstream SMARTOLT-1G-DOWN');
    expect(commands).toContain('service-port 1 vport 1 user-vlan 200 vlan 200');
    expect(commands).toContain('write');

    // Cableado OMCI del canal de INTERNET -- tomado de un running-config real
    // y FUNCIONANDO de otra ONU en la misma OLT (M0761/HWTCDE64BA7C,
    // 2026-10-22): antes el gemport 1 (internet) solo existía a nivel OLT
    // (tcont/gemport/service-port), sin ningún puente OMCI hacia un iphost --
    // espejo exacto de lo que ya se hacía para el canal de gestión.
    expect(commands).toContain('pon-onu-mng gpon-onu_1/1/1:5');
    expect(commands).toContain('flow 1 switch switch_0/1');
    expect(commands).toContain('flow mode 1 tag-filter vlan-filter untag-filter discard');
    expect(commands).toContain('flow 1 pri 0 vlan 200');
    expect(commands).toContain('gemport 1 flow 1');
    expect(commands).toContain('switchport-bind switch_0/1 iphost 1');
    // CONFIRMADO EN VIVO contra OLT_Tabara_Abajo (2026-10-24, ONU
    // CMDCDD4D131E): la sesión real que terminó registrándose en GenieACS
    // aplicó "dhcp-enable" también en iphost 1, espejo del que ya se manda
    // para iphost 2 (canal de gestión) en generateTr069ManagementScript.
    expect(commands).toContain('ip-host 1 dhcp-enable enable ping-response enable traceroute-response enable');
    expect(commands).toContain('vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard');
    expect(commands).toContain('vlan-filter iphost 1 pri 0 vlan 200');

    // Canal de gestión TR-069 (tcont 2 / gemport 2 / service-port 2) -- va
    // junto al canal de internet en la MISMA interfaz "interface gpon-onu_X:Y"
    // y la MISMA llamada a "pon-onu-mng", no en una sesión separada.
    expect(commands).toContain('tcont 2 profile SMARTOLT-VOIPMNG-10M');
    expect(commands).toContain('gemport 2 tcont 2');
    expect(commands).toContain('gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M');
    expect(commands).toContain('service-port 2 vport 2 user-vlan 46 vlan 46');
    // NO se usa "switchport mode hybrid vport N" -- ese comando no aparece en
    // la sesión real que funcionó y puede causar rechazo en este firmware.
    expect(commands.some((c) => c.includes('switchport mode hybrid'))).toBe(false);

    // Cableado OMCI del canal de gestión -- mismo bloque pon-onu-mng que el
    // canal de internet (flow 1/iphost 1 verificados arriba).
    expect(commands).toContain('voip protocol sip');
    expect(commands).toContain('flow 2 switch switch_0/1');
    expect(commands).toContain('flow mode 2 tag-filter vlan-filter untag-filter discard');
    expect(commands).toContain('flow 2 pri 2 vlan 46');
    expect(commands).toContain('gemport 2 flow 2');
    expect(commands).toContain('switchport-bind switch_0/1 iphost 2');
    expect(commands).toContain('switchport-bind switch_0/1 veip 1');
    expect(commands).toContain('ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable');
    expect(commands).toContain('vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard');
    expect(commands).toContain('vlan-filter iphost 2 pri 2 vlan 46');
    expect(commands).toContain('veip 1 port udp 1232 host 2');

    // Bloque TR-069/ACS -- ahora en la misma sesión atómica, tratado como
    // mejor esfuerzo por authorizeOnu() (ver inTr069Block ahí).
    expect(commands).toContain('tr069-mgmt 1 state unlock');
    // Sin tr069AcsUsername/Password en este config, "validate" se omite.
    expect(commands).toContain('tr069-mgmt 1 acs http://10.46.0.1:7547/');
    expect(commands).toContain('tr069-mgmt 1 tag pri 2 vlan 46');
    expect(commands).toContain('security-mgmt 5 state enable mode forward protocol web https');
    expect(commands).toContain('security-mgmt 998 state enable mode forward ingress-type lan protocol web https');
    expect(commands).toContain('security-mgmt 999 state enable ingress-type lan protocol ftp telnet ssh snmp tr069');

    // El reinicio OMCI sigue siendo exclusivo de generateTr069ManagementScript
    // (Etapa 2, reintentable) -- authorizeOnu() nunca reinicia el ONT.
    expect(commands).not.toContain(REBOOT_ONU_SENTINEL);

    // Ahora SÍ entra a "(gpon-onu-mng)#" (para el cableado de internet), así
    // que cierra con "end" (nunca "exit" ahí, ver bloque TR-069) + "write" --
    // ya NO son dos "exit" seguidos, porque "end" ya deja la sesión en el
    // prompt top-level "#" de un solo golpe.
    expect(commands.slice(-2)).toEqual(['end', 'write']);
  });

  it('sin managementMethod TR069 (ej. ONU gestionado por OMCI puro, sin Red TR-069 asignada) NO genera el canal de gestión ni el bloque tr069-mgmt -- bug real evitado: antes esto mandaba literalmente "tr069-mgmt 1 acs undefined" a la OLT porque OnuAuthorizeModal.tsx (Etapa 1 del frontend) no recolecta tr069NetworkId', () => {
    const commands = driver.generateAuthorizationScript({
      ponInterface: 'gpon-olt_1/1/1',
      onuId: 5,
      modelTypeName: 'ZTE-F660',
      serialNumber: 'ZTEGC0123456',
      serviceVlan: 200,
      tcontProfile: 'UP-50M',
      managementMethod: 'OMCI',
      operationMode: 'ROUTER',
      // tr069Vlan/tr069Url deliberadamente ausentes -- escenario real cuando
      // el frontend todavía no manda una Red TR-069 en Etapa 1.
    } as any);

    // El canal de internet sigue intacto.
    expect(commands).toContain('tcont 1 profile UP-50M');
    expect(commands).toContain('gemport 1 tcont 1');
    expect(commands).toContain('service-port 1 vport 1 user-vlan 200 vlan 200');
    expect(commands).toContain('flow 1 switch switch_0/1');
    expect(commands).toContain('switchport-bind switch_0/1 iphost 1');

    // Nada del canal de gestión ni del bloque TR-069/ACS/security-mgmt.
    expect(commands.some((c) => c.includes('tcont 2'))).toBe(false);
    expect(commands.some((c) => c.includes('gemport 2'))).toBe(false);
    expect(commands.some((c) => c.includes('service-port 2'))).toBe(false);
    expect(commands.some((c) => c.includes('flow 2'))).toBe(false);
    expect(commands.some((c) => c.includes('iphost 2'))).toBe(false);
    expect(commands.some((c) => c.includes('veip'))).toBe(false);
    expect(commands.some((c) => c.includes('tr069-mgmt'))).toBe(false);
    expect(commands.some((c) => c.includes('security-mgmt'))).toBe(false);
    // Clave: jamás "undefined" en ningún comando generado.
    expect(commands.some((c) => c.includes('undefined'))).toBe(false);

    expect(commands.slice(-2)).toEqual(['end', 'write']);
  });

  it('con managementMethod TR069 pero SIN tr069Url (Red TR-069 sin acsUrl configurado) tampoco genera el canal de gestión -- misma guardia, otro disparador', () => {
    const commands = driver.generateAuthorizationScript({
      ponInterface: 'gpon-olt_1/1/1',
      onuId: 5,
      modelTypeName: 'ZTE-F660',
      serialNumber: 'ZTEGC0123456',
      serviceVlan: 200,
      tcontProfile: 'UP-50M',
      managementMethod: 'TR069',
      operationMode: 'ROUTER',
      tr069Vlan: 46,
      // tr069Url ausente a propósito.
    } as any);

    expect(commands.some((c) => c.includes('tr069-mgmt'))).toBe(false);
    expect(commands.some((c) => c.includes('undefined'))).toBe(false);
  });

  describe('generateTr069ManagementScript (Etapa 2: RE-apuntar la ONU al ACS, reintento aislado -- asume que tcont 2/gemport 2/service-port 2 ya existen de generateAuthorizationScript, Etapa 1)', () => {
    const baseConfig = {
      ponInterface: 'gpon-olt_1/1/1',
      onuId: 5,
      modelTypeName: 'ZTE-F660',
      serialNumber: 'ZTEGC0123456',
      serviceVlan: 200,
      tr069Vlan: 46,
      tr069Url: 'http://10.46.0.1:7547/',
      tcontProfile: 'UP-50M',
      managementMethod: 'TR069' as const,
      operationMode: 'ROUTER' as const,
    };

    it('nunca genera "tr069-mgmt 1 acs" en blanco -- falla alto y claro si falta tr069Url, en vez de mandarle a la OLT un comando inválido', () => {
      expect(() => driver.generateTr069ManagementScript({ ...baseConfig, tr069Url: undefined })).toThrow(
        /falta la URL del ACS/i,
      );
      expect(() => driver.generateTr069ManagementScript({ ...baseConfig, tr069Url: '' })).toThrow(
        /falta la URL del ACS/i,
      );
    });

    it('genera el bloque OMCI de RE-apuntado al ACS (reintento) -- ya NO crea tcont 2/gemport 2/service-port 2 (eso ahora vive en generateAuthorizationScript, Etapa 1); asume que ya existen de una autorización previa', () => {
      const commands = driver.generateTr069ManagementScript(baseConfig);

      expect(commands).toContain('configure terminal');
      expect(commands).toContain('pon-onu-mng gpon-onu_1/1/1:5');
      // Ya NO crea el segundo camino de datos GPON -- eso se movió a
      // generateAuthorizationScript() tras confirmar en vivo (2026-10-24) que
      // crearlo en una sesión Telnet separada dejaba gemport 2 sin existir
      // cuando este bloque intentaba enlazar "flow 2" a él.
      expect(commands.some((c) => c.includes('tcont 2'))).toBe(false);
      expect(commands.some((c) => c.includes('service-port 2'))).toBe(false);
      expect(commands.some((c) => c.includes('switchport mode hybrid'))).toBe(false);
      expect(commands).toContain('flow 2 switch switch_0/1');
      expect(commands).toContain('flow mode 2 tag-filter vlan-filter untag-filter discard');
      // pri 2 (no 0) -- confirmado en vivo (2026-10-22) contra las mismas dos
      // referencias reales de arriba, consistente con "tr069-mgmt 1 tag pri
      // 2 vlan ...".
      expect(commands).toContain('flow 2 pri 2 vlan 46');
      expect(commands).toContain('gemport 2 flow 2');
      expect(commands).toContain('switchport-bind switch_0/1 iphost 2');
      // CONFIRMADO EN VIVO (2026-10-22) contra un running-config real y
      // FUNCIONANDO de otra ONU en la misma OLT (SmartOLT, ONU
      // HWTCDE64BA7C): sin este segundo bind (el del propio VEIP, no solo el
      // de iphost), "tr069-mgmt ... acs ..." queda rechazado con "%Code
      // 63990-GPONRM" -- causa real del bug, no "Max VEIP" (que era necesario
      // pero no suficiente).
      expect(commands).toContain('switchport-bind switch_0/1 veip 1');
      expect(commands).toContain('ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable');
      expect(commands).toContain('vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard');
      expect(commands).toContain('vlan-filter iphost 2 pri 2 vlan 46');
      // Confirmado en vivo (2026-10-22) presente en ambas referencias reales
      // -- rige la asignación de IP de los 4 puertos LAN de la ONU.
      expect(commands).toContain('dhcp-ip ethuni eth_0/1 from-onu');
      expect(commands).toContain('dhcp-ip ethuni eth_0/2 from-onu');
      expect(commands).toContain('dhcp-ip ethuni eth_0/3 from-onu');
      expect(commands).toContain('dhcp-ip ethuni eth_0/4 from-onu');
      expect(commands).toContain('veip 1 port udp 1232 host 2');
      expect(commands).toContain('tr069-mgmt 1 state unlock');
      // "acs <url>" y "tag pri <n> vlan <n>" son DOS comandos separados --
      // confirmado en vivo contra OLT_Tabara_Abajo (2026-10-20) vía ayuda
      // contextual ("tr069-mgmt 1 ?"): antes se mandaban como uno solo
      // ("tr069-mgmt 1 acs <url> tag pri 2 vlan 46"), rechazado con "%Error
      // 20201: Invalid input detected ... Invalid command key word".
      // Sin tr069AcsUsername/Password en baseConfig, "validate" se omite.
      expect(commands).toContain('tr069-mgmt 1 acs http://10.46.0.1:7547/');
      // "tr069-mgmt 1 tag pri <n> vlan <n>" -- confirmado presente en los
      // running-config reales y funcionando de SmartOLT (X2251, M1382); usa
      // tr069Vlan (46 en baseConfig), nunca un valor fijo.
      expect(commands).toContain('tr069-mgmt 1 tag pri 2 vlan 46');
      // Confirmado por comparación directa (2026-10-23) contra running-config
      // reales y funcionando de SmartOLT en la misma OLT -- debe ser el
      // PRIMER comando dentro de "pon-onu-mng" (antes de flow/gemport/iphost).
      expect(commands).toContain('voip protocol sip');
      // CONFIRMADO EN VIVO contra OLT_Tabara_Abajo (2026-10-24, ONU
      // CMDCDD4D131E) como parte de la secuencia real que terminó
      // registrándose en GenieACS.
      expect(commands).toContain('security-mgmt 5 state enable mode forward protocol web https');
      // Confirmado en vivo (2026-10-22) presente en ambas referencias reales.
      expect(commands).toContain('security-mgmt 998 state enable mode forward ingress-type lan protocol web https');
      expect(commands).toContain('security-mgmt 999 state enable ingress-type lan protocol ftp telnet ssh snmp tr069');

      // El cableado OMCI (flow/iphost/veip/state unlock) va ANTES de "acs" --
      // orden confirmado en vivo, cambiarlo rompería la secuencia real.
      const unlockIdx = commands.indexOf('tr069-mgmt 1 state unlock');
      const acsIdx = commands.indexOf('tr069-mgmt 1 acs http://10.46.0.1:7547/');
      expect(unlockIdx).toBeLessThan(acsIdx);

      // "switchport-bind switch_0/1 veip 1" debe ir ANTES de "veip 1 port udp
      // 1232 host 2" -- mismo orden que el running-config real de SmartOLT.
      const bindVeipIdx = commands.indexOf('switchport-bind switch_0/1 veip 1');
      const veipPortIdx = commands.indexOf('veip 1 port udp 1232 host 2');
      expect(bindVeipIdx).toBeLessThan(veipPortIdx);

      // Los SET de OMCI de este ONT no son idempotentes -- un reinicio
      // obligatorio (vía el sentinel que `applyTr069Management()` intercepta,
      // ver REBOOT_ONU_SENTINEL) va justo antes de "end", que NUNCA es "exit"
      // -- con "exit" la OLT real pregunta "Confirm to logout without
      // saving? [yes/no]:" y la sesión se cuelga (bug real en producción,
      // 2026-10-19, ver también los ejemplos del manual ZXA10 C300 §2.11-2.13,
      // todos usan "end" ahí).
      expect(commands.slice(-3)).toEqual([REBOOT_ONU_SENTINEL, 'end', 'write']);
    });

    it('agrega "validate basic username/password" solo si la Red TR-069 tiene credenciales de ACS -- confirmado en vivo (2026-10-22) en el running-config real de X2251/HWTCBC05BF9C', () => {
      const withCreds = driver.generateTr069ManagementScript({
        ...baseConfig,
        tr069AcsUsername: 'soltcpe',
        tr069AcsPassword: 'FiEpcY4srQj6',
      });
      expect(withCreds).toContain(
        'tr069-mgmt 1 acs http://10.46.0.1:7547/ validate basic username soltcpe password FiEpcY4srQj6',
      );
      expect(withCreds).not.toContain('tr069-mgmt 1 acs http://10.46.0.1:7547/');

      const withoutCreds = driver.generateTr069ManagementScript(baseConfig);
      expect(withoutCreds).toContain('tr069-mgmt 1 acs http://10.46.0.1:7547/');
    });
  });

  it('sin "description", no agrega esa línea -- opcional, no rompe compatibilidad con llamadas existentes', () => {
    const commands = driver.generateAuthorizationScript({
      ponInterface: 'gpon-olt_1/1/1',
      onuId: 5,
      modelTypeName: 'ZTE-F660',
      serialNumber: 'ZTEGC0123456',
      clientName: 'JuanPerez',
      serviceVlan: 200,
      managementMethod: 'OMCI',
      operationMode: 'ROUTER',
    });

    expect(commands.some((c) => c.startsWith('description '))).toBe(false);
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

  it('generateAuthorizationScript siempre cierra con "end" + "write" (prompt top-level "#"), sin importar managementMethod -- desde que entra a "(gpon-onu-mng)#" para el cableado iphost 1/flow 1 del canal de internet (2026-10-22), "end" es lo que deja la sesión en el prompt top-level de un solo golpe (nunca "exit" ahí, ver bloque TR-069 para el bug real de por qué)', () => {
    const omciCommands = driver.generateAuthorizationScript({
      ponInterface: 'gpon-olt_1/1/1',
      onuId: 5,
      modelTypeName: 'ZTE-F660',
      serialNumber: 'ZTEGC0123456',
      serviceVlan: 200,
      managementMethod: 'OMCI',
      operationMode: 'ROUTER',
    });
    expect(omciCommands.slice(-2)).toEqual(['end', 'write']);

    const tr069Commands = driver.generateAuthorizationScript({
      ponInterface: 'gpon-olt_1/1/1',
      onuId: 5,
      modelTypeName: 'ZTE-F660',
      serialNumber: 'ZTEGC0123456',
      serviceVlan: 200,
      tr069Url: 'http://10.46.0.1:7547/',
      managementMethod: 'TR069',
      operationMode: 'ROUTER',
    });
    expect(tr069Commands.slice(-2)).toEqual(['end', 'write']);
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

    // Fixture CONFIRMADA EN VIVO (2026-10-23, CMDCDD4D131E / OLT_Tabara_Abajo):
    // en la fila "down" el orden real es Tx antes que Rx (al revés que en la
    // fila "up"), y la atenuación es un número suelto en "(dB)" al final de
    // cada línea, no la palabra literal "attenuation:". El parser viejo
    // asumía el mismo orden Rx/Tx en ambas filas y la palabra "attenuation:",
    // por lo que rxDbm/txDbm/attenuationDb -- los 3 campos que muestra el
    // modal "Ficha 360" -- quedaban SIEMPRE undefined para cualquier ONU.
    expect(result.upRxDbm).toBe(-13.404);
    expect(result.txDbm).toBe(1.376); // Potencia TX = láser propio de la ONU (fila "up")
    expect(result.downRxDbm).toBe(-21.25);
    expect(result.rxDbm).toBe(-21.25); // Potencia recibida en la ONU (fila "down")
    expect(result.attenuationDb).toBe(27.969); // Atenuación real OLT->ONU (fila "down")
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

  describe('ensureOnuTypeProfile (perfil de capacidades OMCI -- max-tcont/max-gemport/etc. diseñados por analogía, AÚN NO verificados en vivo; "max-veip 1" sí confirmado en vivo, 2026-10-22, ver zte-c320.driver.ts)', () => {
    it('no crea nada si "show onu-type gpon <nombre>" ya reporta el perfil existente', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === 'show onu-type gpon HUAWEY-HG8546M') {
          return Promise.resolve('Onu Type Name :HUAWEY-HG8546M\r\nMax-Tcont :8');
        }
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.ensureOnuTypeProfile(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { name: 'HUAWEY-HG8546M', ethPorts: 4, potsPorts: 2 },
      );

      expect(result.ok).toBe(true);
      expect(executeCommand).not.toHaveBeenCalledWith('configure terminal');
    });

    it('repara "max-veip" en caliente si el onu-type YA EXISTE con "Max VEIP: 0" (caso real: HUAWEY-HG8145V5 preexistente)', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === 'show onu-type gpon HUAWEY-HG8145V5') {
          return Promise.resolve(
            'ONU type name:          HUAWEY-HG8145V5\r\nPON type:               gpon\r\nMax VEIP:               0(default: 1 VEIP)\r\n',
          );
        }
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.ensureOnuTypeProfile(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { name: 'HUAWEY-HG8145V5' },
      );

      expect(result.ok).toBe(true);
      expect(executeCommand.mock.calls.map((c: any[]) => c[0])).toEqual([
        'show onu-type gpon HUAWEY-HG8145V5',
        'configure terminal',
        'pon',
        'onu-type HUAWEY-HG8145V5 gpon max-veip 1',
        'exit',
        'exit',
        'write',
      ]);
    });

    it('NO toca nada si el onu-type ya existe y ya tiene "Max VEIP: 1" o más', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === 'show onu-type gpon ZTEG-F660') {
          return Promise.resolve('ONU type name:          ZTEG-F660\r\nMax VEIP:               1\r\n');
        }
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      await driver.ensureOnuTypeProfile(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { name: 'ZTEG-F660' },
      );

      expect(executeCommand).toHaveBeenCalledTimes(1);
      expect(executeCommand).not.toHaveBeenCalledWith('configure terminal');
    });

    it('responde ok:true (mejor esfuerzo) aunque la OLT rechace la reparación de "max-veip" -- ej. "Profile is being used" porque otras ONUs ya usan ese onu-type (bug real confirmado: esto tumbaba toda la autorización antes de este fix)', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === 'show onu-type gpon HUAWEY-HG8145V5') {
          return Promise.resolve('ONU type name:          HUAWEY-HG8145V5\r\nMax VEIP:               0(default: 1 VEIP)\r\n');
        }
        if (cmd === 'onu-type HUAWEY-HG8145V5 gpon max-veip 1') {
          return Promise.resolve('%Code 70296 : Profile is being used.');
        }
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.ensureOnuTypeProfile(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { name: 'HUAWEY-HG8145V5' },
      );

      expect(result.ok).toBe(true);
      // No debe mandar "write" si la corrección fue rechazada...
      expect(executeCommand).not.toHaveBeenCalledWith('write');
      // ...pero SÍ debe salir limpio de "configure terminal"/"pon" (no dejar
      // la sesión colgada en modo config para los comandos que vienen después
      // en el mismo script de autorización).
      expect(executeCommand.mock.calls.map((c: any[]) => c[0])).toEqual([
        'show onu-type gpon HUAWEY-HG8145V5',
        'configure terminal',
        'pon',
        'onu-type HUAWEY-HG8145V5 gpon max-veip 1',
        'exit',
        'exit',
      ]);
    });

    it('crea el perfil entrando a "configure terminal"/"pon" y declarando max-tcont/max-gemport/etc. + puertos eth/pots si no existe', async () => {
      const executeCommand = jest.fn().mockResolvedValue('');
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.ensureOnuTypeProfile(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { name: 'HUAWEY-HG8546M', ethPorts: 4, potsPorts: 2 },
      );

      expect(result.ok).toBe(true);
      expect(executeCommand.mock.calls.map((c: any[]) => c[0])).toEqual([
        'show onu-type gpon HUAWEY-HG8546M',
        'configure terminal',
        'pon',
        'onu-type HUAWEY-HG8546M gpon description 4ETH,2POTS max-tcont 8 max-gemport 32 max-switch-perslot 8 max-flow-perswitch 8 max-veip 1',
        'onu-type-if HUAWEY-HG8546M eth_0/1-4',
        'onu-type-if HUAWEY-HG8546M pots_0/1-2',
        'exit',
        'exit',
        'write',
      ]);
    });

    it('omite "onu-type-if" para eth/pots si ethPorts/potsPorts no vienen definidos', async () => {
      const executeCommand = jest.fn().mockResolvedValue('');
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      await driver.ensureOnuTypeProfile(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { name: 'ZTE-F660' },
      );

      expect(executeCommand).not.toHaveBeenCalledWith(expect.stringContaining('onu-type-if'));
    });

    it('responde ok:false si la OLT rechaza la creación del onu-type, sin llegar a "write"', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('onu-type ')) return Promise.resolve('%Error 20200: Invalid input detected');
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.ensureOnuTypeProfile(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { name: 'BROKEN-TYPE' },
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Invalid input detected');
      expect(executeCommand).not.toHaveBeenCalledWith('write');
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

  describe('authorizeOnu() detecta rechazos reales de la OLT (bug real confirmado en vivo contra OLT_Tabara_Abajo, 2026-10-19: antes se reportaba éxito sin haber autorizado nada)', () => {
    const baseConfig = {
      ponInterface: 'gpon-olt_1/1/1',
      onuId: 2,
      modelTypeName: 'Generico',
      serialNumber: 'TEST0000FA11',
      serviceVlan: 400,
      managementMethod: 'OMCI' as const,
      operationMode: 'ROUTER' as const,
    };

    it('falla con ok:false si la OLT rechaza con formato "%Code <n>-<módulo> : <mensaje>" (ej. Tipo de ONU inválido)', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        // El onu-type ya existe -- esta prueba es sobre el rechazo del script
        // principal de autorización, no sobre el aprovisionamiento del tipo.
        if (cmd.startsWith('show onu-type gpon')) return Promise.resolve('Onu Type Name :Generico');
        if (cmd.startsWith('onu ')) return Promise.resolve('\r\n%Code 63904-GPONRM : Not support this ONU.\r\nOLT#');
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.authorizeOnu(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        baseConfig,
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Not support this ONU');
      // No debe seguir ejecutando el resto del script tras el rechazo.
      expect(executeCommand).not.toHaveBeenCalledWith('write');
    });

    it('falla con ok:false si la OLT rechaza con formato "%Error <n>: <mensaje>"', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('onu ')) return Promise.resolve('\r\n%Error 10: Invalid parameter!\r\nOLT#');
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.authorizeOnu(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        baseConfig,
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Invalid parameter');
    });

    it('tolera "%Code 62391-GPONSRV : The entry is existed. This is a re-create operation." en "onu <id> type ... sn ..." y sigue con el resto del script -- bug real confirmado en vivo contra OLT_Tabara_Abajo (2026-10-20): un reintento tras una autorización previa que falló DESPUÉS de este paso dejaba el ONU ya registrado, y tratar esto como rechazo fatal nunca llegaba a aplicar tcont/vlan/service-port', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('show onu-type gpon')) return Promise.resolve('Onu Type Name :Generico');
        if (cmd.startsWith('onu ')) {
          return Promise.resolve('\r\n%Code 62391-GPONSRV : The entry is existed. This is a re-create operation.\r\nOLT#');
        }
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.authorizeOnu(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        baseConfig,
      );

      expect(result.ok).toBe(true);
      expect(executeCommand).toHaveBeenCalledWith('write');
    });

    it('tolera "%Code 66661: The service is already existed." en "service-port ..." y sigue con el resto del script -- segundo mensaje real distinto confirmado en vivo contra OLT_Tabara_Abajo (2026-10-20), mismo significado que el "entry is existed" del paso "onu type sn": un reintento tras un fallo posterior a este paso no debe abortar de nuevo aquí', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('show onu-type gpon')) return Promise.resolve('Onu Type Name :Generico');
        if (cmd.startsWith('service-port ')) {
          return Promise.resolve('\r\n%Code 66661: The service is already existed.\r\nOLT#');
        }
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.authorizeOnu(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        baseConfig,
      );

      expect(result.ok).toBe(true);
      expect(executeCommand).toHaveBeenCalledWith('write');
    });

    it('tolera "%Code 63869-GPONRM : Record already exists." en "flow <n> switch switch_0/1" (y comandos similares del cableado OMCI) -- bug real confirmado en producción (2026-10-22): un reintento de autorización que ya había cableado el canal de internet (ver generateAuthorizationScript) abortaba aquí mismo en vez de tolerarlo, pese a ser el mismo significado que "is existed"', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('show onu-type gpon')) return Promise.resolve('Onu Type Name :Generico');
        if (cmd === 'flow 1 switch switch_0/1') {
          return Promise.resolve('\r\n%Code 63869-GPONRM : Record already exists.\r\nOLT#');
        }
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.authorizeOnu(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        baseConfig,
      );

      expect(result.ok).toBe(true);
      expect(executeCommand).toHaveBeenCalledWith('write');
    });

    it('tolera "%Code 63873-GPONRM : GEM port already exists." en "gemport 1 flow 1" (y comandos similares) sin abortar', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('show onu-type gpon')) return Promise.resolve('Onu Type Name :Generico');
        if (cmd === 'gemport 1 flow 1') {
          return Promise.resolve('\r\n%Code 63873-GPONRM : GEM port already exists.\r\nOLT#');
        }
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.authorizeOnu(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        baseConfig,
      );

      expect(result.ok).toBe(true);
      expect(executeCommand).toHaveBeenCalledWith('write');
    });

    it('un "%Code" que NO menciona "existed" sigue tratándose como rechazo fatal, sin importar el comando', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('show onu-type gpon')) return Promise.resolve('Onu Type Name :Generico');
        if (cmd.startsWith('tcont ')) {
          return Promise.resolve('\r\n%Code 10: Invalid parameter!\r\nOLT#');
        }
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.authorizeOnu(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        baseConfig,
      );

      expect(result.ok).toBe(false);
      expect(executeCommand).not.toHaveBeenCalledWith('write');
    });

    it('tiene éxito y ejecuta "write" cuando ningún comando es rechazado', async () => {
      const executeCommand = jest.fn().mockResolvedValue('\r\n.[Successful]\r\nOLT#');
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.authorizeOnu(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { ...baseConfig, modelTypeName: 'ZTE-F660' },
      );

      expect(result.ok).toBe(true);
      expect(executeCommand).toHaveBeenCalledWith('write');
    });

    it('tolera que la OLT rechace "no onu <id>" (ej. "does not exist" si la ONU nunca existió) sin abortar la autorización -- mejor esfuerzo a propósito: nada que borrar no es un error', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('no onu ')) {
          return Promise.resolve('\r\n%Code 63905-GPONRM : ONU does not exist.\r\nOLT#');
        }
        return Promise.resolve('\r\n.[Successful]\r\nOLT#');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      const result = await driver.authorizeOnu(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { ...baseConfig, modelTypeName: 'ZTE-F660' },
      );

      expect(result.ok).toBe(true);
      expect(executeCommand).toHaveBeenCalledWith('no onu 2');
      expect(executeCommand).toHaveBeenCalledWith('write');
    });

    it('borra la ONU antes de recrearla -- "no onu <id>" se manda ANTES de "onu <id> type ... sn ..." dentro de la misma sesión', async () => {
      const callOrder: string[] = [];
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        callOrder.push(cmd);
        return Promise.resolve('\r\n.[Successful]\r\nOLT#');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        close: jest.fn(),
      });

      await driver.authorizeOnu(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { ...baseConfig, modelTypeName: 'ZTE-F660' },
      );

      const noOnuIdx = callOrder.indexOf('no onu 2');
      const createOnuIdx = callOrder.indexOf('onu 2 type ZTE-F660 sn TEST0000FA11');
      expect(noOnuIdx).toBeGreaterThanOrEqual(0);
      expect(createOnuIdx).toBeGreaterThan(noOnuIdx);
    });
  });

  describe('applyTr069Management() trata el push OMCI de TR-069/ACS como mejor esfuerzo, no crítico (bug real confirmado en vivo contra OLT_Tabara_Abajo, 2026-10-20: "%Code 63990-GPONRM : ONT return error: command processing error." en "tr069-mgmt 1 acs <url>") -- Etapa 2 del flujo de 3 etapas, separada de authorizeOnu()', () => {
    const tr069Config = {
      ponInterface: 'gpon-olt_1/2/15',
      onuId: 1,
      modelTypeName: 'HUAWEY-HG8546M',
      serialNumber: 'CMDCDD4D131E',
      serviceVlan: 404,
      tr069Url: 'http://acs.sumtech.com.do:7547',
      tr069Vlan: 46,
      managementMethod: 'TR069' as const,
      operationMode: 'ROUTER' as const,
    };

    beforeEach(() => {
      // applyAcsUrlWithRetries() espera delayMs (20s por defecto) entre
      // reintentos -- sin este stub, el test que rechaza el ACS en todos los
      // intentos dormiría de verdad ~100s (6 intentos x ~20s).
      jest.spyOn<any, any>(driver, 'delay').mockResolvedValue(undefined);
    });

    it('si el ONT rechaza "tr069-mgmt ... acs ..." a nivel OMCI, el resto del script (incluido "write") igual se ejecuta y el resultado es ok:true con "warning"', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('tr069-mgmt') && cmd.includes(' acs ')) {
          return Promise.resolve('\r\n%Code 63990-GPONRM : ONT return error:command processing error.\r\nOLT#');
        }
        return Promise.resolve('');
      });
      const rebootOnu = jest.fn().mockResolvedValue(undefined);
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu,
        close: jest.fn(),
      });

      const result = await driver.applyTr069Management(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        tr069Config,
      );

      expect(result.ok).toBe(true);
      expect(result.warning).toContain('TR-069/ACS');
      expect(result.warning).toContain('ONT return error');
      // El resto del script (security-mgmt/reboot/end/write) debe seguir ejecutándose.
      expect(executeCommand).toHaveBeenCalledWith('security-mgmt 999 state enable ingress-type lan protocol ftp telnet ssh snmp tr069');
      expect(rebootOnu).toHaveBeenCalled();
      expect(executeCommand).toHaveBeenCalledWith('end');
      expect(executeCommand).toHaveBeenCalledWith('write');
    });

    it('si TODO el bloque TR-069 tiene éxito, el resultado es ok:true SIN "warning" y se reinicia el ONT (los SET de OMCI no son idempotentes -- ver REBOOT_ONU_SENTINEL)', async () => {
      const executeCommand = jest.fn().mockResolvedValue('');
      const rebootOnu = jest.fn().mockResolvedValue(undefined);
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu,
        close: jest.fn(),
      });

      const result = await driver.applyTr069Management(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        tr069Config,
      );

      expect(result.ok).toBe(true);
      expect(result.warning).toBeUndefined();
      expect(rebootOnu).toHaveBeenCalled();
      // El sentinel nunca debe llegar a executeCommand -- applyTr069Management()
      // lo intercepta y llama a session.rebootOnu() en su lugar.
      expect(executeCommand).not.toHaveBeenCalledWith(REBOOT_ONU_SENTINEL);
    });

    it('tolera "%Code 63873-GPONRM : GEM port already exists." en "gemport 2 flow 2" sin generar warning (paso ya aplicado previamente)', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === 'gemport 2 flow 2') {
          return Promise.resolve('\r\n%Code 63873-GPONRM : GEM port already exists.\r\nOLT#');
        }
        return Promise.resolve('');
      });
      const rebootOnu = jest.fn().mockResolvedValue(undefined);
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu,
        close: jest.fn(),
      });

      const result = await driver.applyTr069Management(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        tr069Config,
      );

      expect(result.ok).toBe(true);
      expect(result.warning).toBeUndefined();
      expect(executeCommand).toHaveBeenCalledWith('voip protocol sip');
      expect(executeCommand).toHaveBeenCalledWith('write');
      expect(rebootOnu).toHaveBeenCalled();
    });

    it('si "rebootOnu()" rechaza (ej. el ONT no confirma el "[yes/no]:" a tiempo), el resultado sigue siendo ok:true con "warning" -- mismo criterio de mejor esfuerzo', async () => {
      const executeCommand = jest.fn().mockResolvedValue('');
      const rebootOnu = jest.fn().mockRejectedValue(new Error('Timeout esperando confirmación de reinicio OMCI del ONT.'));
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu,
        close: jest.fn(),
      });

      const result = await driver.applyTr069Management(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        tr069Config,
      );

      expect(result.ok).toBe(true);
      expect(result.warning).toContain('reinicio OMCI');
      // El resto del script (end/write) debe seguir ejecutándose pese al fallo.
      expect(executeCommand).toHaveBeenCalledWith('end');
      expect(executeCommand).toHaveBeenCalledWith('write');
    });

    it('un rechazo en el PRIMER comando real del bloque (ej. "voip protocol sip" inválido) también es mejor esfuerzo -- el script completo generado por generateTr069ManagementScript() ES el bloque TR-069 (bug real corregido 2026-10-23: antes esto abortaba toda la Etapa 2 sin reportar warning)', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === 'voip protocol sip') return Promise.resolve('\r\n%Code 10: Invalid parameter!\r\nOLT#');
        return Promise.resolve('');
      });
      const rebootOnu = jest.fn().mockResolvedValue(undefined);
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu,
        close: jest.fn(),
      });

      const result = await driver.applyTr069Management(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        tr069Config,
      );

      expect(result.ok).toBe(true);
      expect(result.warning).toContain('voip protocol sip');
      // El resto del script (incluido el reinicio OMCI y el write final) debe
      // seguir corriendo pese al rechazo -- mismo criterio de mejor esfuerzo
      // que el resto del bloque TR-069.
      expect(executeCommand).toHaveBeenCalledWith('write');
      expect(rebootOnu).toHaveBeenCalled();
    });

    it('reintenta "tr069-mgmt ... acs ..." con reinicio entre cada intento -- si la OLT lo acepta en el 4to intento, no hay warning y se reinició 4 veces (bug real: antes era un intento único, mejor esfuerzo, que dependía de un job externo lento para reintentar)', async () => {
      let acsAttempts = 0;
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('tr069-mgmt') && cmd.includes(' acs ')) {
          acsAttempts++;
          if (acsAttempts < 4) {
            return Promise.resolve('\r\n%Code 63990-GPONRM : ONT return error:command processing error.\r\nOLT#');
          }
          return Promise.resolve('');
        }
        return Promise.resolve('');
      });
      const rebootOnu = jest.fn().mockResolvedValue(undefined);
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu,
        close: jest.fn(),
      });

      const result = await driver.applyTr069Management(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        tr069Config,
      );

      expect(result.ok).toBe(true);
      expect(result.warning).toBeUndefined();
      expect(acsAttempts).toBe(4);
      // 4 reinicios por los reintentos del ACS -- ninguno extra del
      // REBOOT_ONU_SENTINEL (acsRebootHandled evita ese reinicio duplicado).
      expect(rebootOnu).toHaveBeenCalledTimes(4);
    });

    it('agota los 6 intentos y reporta el warning final con el último rechazo, si la OLT nunca acepta el ACS', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('tr069-mgmt') && cmd.includes(' acs ')) {
          return Promise.resolve('\r\n%Code 63990-GPONRM : ONT return error:command processing error.\r\nOLT#');
        }
        return Promise.resolve('');
      });
      const rebootOnu = jest.fn().mockResolvedValue(undefined);
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu,
        close: jest.fn(),
      });

      const result = await driver.applyTr069Management(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        tr069Config,
      );

      expect(result.ok).toBe(true);
      expect(result.warning).toContain('6 intentos');
      expect(rebootOnu).toHaveBeenCalledTimes(6);
      const acsCalls = executeCommand.mock.calls.filter((c: any[]) => c[0].startsWith('tr069-mgmt') && c[0].includes(' acs '));
      expect(acsCalls).toHaveLength(6);
    });

    it('reporta un warning real si "Config state" queda en "fail" tras aplicar, aunque NINGÚN comando individual haya sido rechazado -- bug real confirmado (2026-10-23) comparando running-config reales: una ONU terminó con "tr069-mgmt"/"veip ... host 2" apuntando a un iphost 2 que nunca se creó, sin ningún %Error/%Code visible', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('show gpon onu detail-info')) {
          return Promise.resolve('\r\nONU interface: gpon-onu_1/2/15:1\r\n  Config state:        fail\r\n  Phase state:         working\r\nOLT#');
        }
        return Promise.resolve('');
      });
      const rebootOnu = jest.fn().mockResolvedValue(undefined);
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu,
        close: jest.fn(),
      });

      const result = await driver.applyTr069Management(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        tr069Config,
      );

      expect(result.ok).toBe(true);
      expect(result.warning).toContain('Config state');
      expect(result.warning).toContain('fail');
      expect(executeCommand).toHaveBeenCalledWith('show gpon onu detail-info gpon-onu_1/2/15:1');
    });

    it('NO agrega ningún warning si "Config state" queda en "success" y nada fue rechazado', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('show gpon onu detail-info')) {
          return Promise.resolve('\r\nONU interface: gpon-onu_1/2/15:1\r\n  Config state:        success\r\n  Phase state:         working\r\nOLT#');
        }
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu: jest.fn().mockResolvedValue(undefined),
        close: jest.fn(),
      });

      const result = await driver.applyTr069Management(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        tr069Config,
      );

      expect(result.ok).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('no tumba el resultado si "show gpon onu detail-info" falla al verificar -- mejor esfuerzo, igual que el resto de la verificación', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('show gpon onu detail-info')) {
          return Promise.reject(new Error('Timeout de Telnet'));
        }
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu: jest.fn().mockResolvedValue(undefined),
        close: jest.fn(),
      });

      const result = await driver.applyTr069Management(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        tr069Config,
      );

      expect(result.ok).toBe(true);
      expect(result.warning).toBeUndefined();
    });
  });

  describe('updateTr069AcsUrl() -- a diferencia de applyTr069Management(), un rechazo de "tr069-mgmt ... acs ..." es un error DURO, no un warning (solo toca el ACS, no re-cablea el resto del canal de gestión)', () => {
    const acsConfig = {
      ponInterface: 'gpon-olt_1/2/15',
      onuId: 1,
      tr069Url: 'http://10.254.0.1:7547',
    };

    it('si la OLT rechaza "tr069-mgmt 1 acs ..." el resultado es ok:false con el error real, y nunca llega a "write"', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('tr069-mgmt') && cmd.includes(' acs ')) {
          return Promise.resolve('\r\n%Code 63990-GPONRM : ONT return error:command processing error.\r\nOLT#');
        }
        return Promise.resolve('');
      });
      const rebootOnu = jest.fn().mockResolvedValue(undefined);
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu,
        close: jest.fn(),
      });

      const result = await driver.updateTr069AcsUrl(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        acsConfig,
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain('ONT return error');
      expect(executeCommand).not.toHaveBeenCalledWith('write');
      expect(rebootOnu).not.toHaveBeenCalled();
    });

    it('si la OLT acepta el cambio, manda solo "configure terminal"/"pon-onu-mng"/"tr069-mgmt 1 acs ..."/"end"/"write" -- sin re-tocar tcont/gemport/service-port/flow/vlan-filter/veip', async () => {
      const executeCommand = jest.fn().mockResolvedValue('');
      const rebootOnu = jest.fn().mockResolvedValue(undefined);
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu,
        close: jest.fn(),
      });

      const result = await driver.updateTr069AcsUrl(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        acsConfig,
      );

      expect(result.ok).toBe(true);
      expect(result.warning).toBeUndefined();
      expect(executeCommand.mock.calls.map((c: any[]) => c[0])).toEqual([
        'configure terminal',
        'pon-onu-mng gpon-onu_1/2/15:1',
        'tr069-mgmt 1 acs http://10.254.0.1:7547',
        'end',
        'write',
      ]);
      expect(rebootOnu).toHaveBeenCalled();
    });

    it('agrega "validate basic username/password" en el mismo comando cuando la Red TR-069 tiene credenciales de ACS', async () => {
      const executeCommand = jest.fn().mockResolvedValue('');
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu: jest.fn().mockResolvedValue(undefined),
        close: jest.fn(),
      });

      await driver.updateTr069AcsUrl(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        { ...acsConfig, tr069AcsUsername: 'soltcpe', tr069AcsPassword: 'FiEpcY4srQj6' },
      );

      expect(executeCommand).toHaveBeenCalledWith(
        'tr069-mgmt 1 acs http://10.254.0.1:7547 validate basic username soltcpe password FiEpcY4srQj6',
      );
    });

    it('si "rebootOnu()" rechaza, el resultado sigue siendo ok:true con "warning" -- el ACS sí quedó configurado, solo falló confirmar el reinicio (problema de temporización ya conocido, no evidencia de que la OLT haya rechazado el ACS)', async () => {
      const executeCommand = jest.fn().mockResolvedValue('');
      const rebootOnu = jest.fn().mockRejectedValue(new Error('Timeout esperando confirmación de reinicio OMCI del ONT.'));
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu,
        close: jest.fn(),
      });

      const result = await driver.updateTr069AcsUrl(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        acsConfig,
      );

      expect(result.ok).toBe(true);
      expect(result.warning).toContain('reinicio OMCI');
      expect(executeCommand).toHaveBeenCalledWith('end');
      expect(executeCommand).toHaveBeenCalledWith('write');
    });

    it('si la OLT rechaza entrar a "pon-onu-mng" (ej. ONU inexistente), el resultado es ok:false y nunca intenta el comando del ACS', async () => {
      const executeCommand = jest.fn().mockImplementation((cmd: string) => {
        if (cmd.startsWith('pon-onu-mng')) return Promise.resolve('\r\n%Error 20202: Invalid input detected.\r\nOLT#');
        return Promise.resolve('');
      });
      jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({
        connectAndLogin: jest.fn().mockResolvedValue(undefined),
        executeCommand,
        rebootOnu: jest.fn().mockResolvedValue(undefined),
        close: jest.fn(),
      });

      const result = await driver.updateTr069AcsUrl(
        { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' },
        acsConfig,
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain('pon-onu-mng');
      expect(executeCommand).not.toHaveBeenCalledWith(expect.stringContaining('tr069-mgmt'));
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

  it('tr069AutoProvisioning ya está en true -- CONFIRMADO EN VIVO (2026-10-24, ONU CMDCDD4D131E): el bloque completo (canal de gestión + TR-069) en una sola sesión atómica terminó registrándose en GenieACS', () => {
    expect(driver.getCapabilities().tr069AutoProvisioning).toBe(true);
  });

  it('dbaProfile (TCONT) ya está en true -- confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19)', () => {
    expect(driver.getCapabilities().dbaProfile).toBe(true);
  });

  it('downstreamTrafficProfile ya está en true -- confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19)', () => {
    expect(driver.getCapabilities().downstreamTrafficProfile).toBe(true);
  });

  it('onuTypeProfileProvisioning ya está en true -- sintaxis confirmada contra el manual oficial y corregida en vivo', () => {
    expect(driver.getCapabilities().onuTypeProfileProvisioning).toBe(true);
  });

  it('authorizeOnu() asegura el onu-type (modelTypeName + ethPorts/potsPorts) antes de correr el script de autorización', async () => {
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
        modelTypeName: 'HUAWEY-HG8546M',
        ethPorts: 4,
        potsPorts: 2,
        serialNumber: 'ZTEGC0123456',
        serviceVlan: 400,
        managementMethod: 'OMCI',
        operationMode: 'ROUTER',
      },
    );

    expect(result.ok).toBe(true);
    const calledCommands = executeCommand.mock.calls.map((c) => c[0]);
    expect(calledCommands.indexOf('show onu-type gpon HUAWEY-HG8546M')).toBe(0);
    expect(calledCommands).toContain('onu-type-if HUAWEY-HG8546M eth_0/1-4');
    expect(calledCommands).toContain('onu-type-if HUAWEY-HG8546M pots_0/1-2');
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

  it('rebootOnu() responde el prompt interactivo "[yes/no]:" con "yes" y resuelve cuando vuelve el prompt de la OLT -- CONFIRMADO EN VIVO contra OLT_Tabara_Abajo (2026-10-20, ONU CMDCDD4D131E): a diferencia de executeCommand(), este SÍ debe responder esa confirmación en vez de rechazar', async () => {
    const session = new ZteTelnetSession({ host: '10.0.0.10', port: 23, username: 'admin', password: 'password' });
    const fakeSocket = createFakeSocket();
    (session as any).socket = fakeSocket;

    const promise = session.rebootOnu(5000);

    fakeSocket.emit('data', Buffer.from('\r\nConfirm to reboot? [yes/no]:'));
    expect(fakeSocket.write).toHaveBeenCalledWith('yes\r\n');

    fakeSocket.emit('data', Buffer.from('\r\n(gpon-onu-mng)#'));

    await expect(promise).resolves.toBeUndefined();
    expect(fakeSocket.write).toHaveBeenCalledWith('reboot\r\n');
  });

  it('rebootOnu() rechaza si el prompt "[yes/no]:" nunca llega (timeout) -- quien llame esto debe tratarlo como mejor esfuerzo, igual que el resto del bloque TR-069', async () => {
    const session = new ZteTelnetSession({ host: '10.0.0.10', port: 23, username: 'admin', password: 'password' });
    const fakeSocket = createFakeSocket();
    (session as any).socket = fakeSocket;

    const promise = session.rebootOnu(50);

    await expect(promise).rejects.toThrow(/timeout/i);
  });
});
