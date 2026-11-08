import { Logger } from '@nestjs/common';
import { AuthorizeOnuParams } from '../ports/olt-driver.port';
import { applyTr069ManagementWithSession, getTr069PacingDelay } from './zte-c320-tr069';
import { ZteC320Driver } from './zte-c320.driver';

/**
 * Camino rápido de "Aplicar Perfil TR-069" (Etapa 2) cuando la OLT ya tiene
 * el transporte y/o el bloque OMCI aplicados -- caso real confirmado en
 * vivo (2026-11-06, OLT_Tabara_Abajo, ONU gpon-onu_1/3/1:3): reaplicar un
 * perfil ya correcto tardaba ~210s de pacing y reenlazaba en caliente
 * "switchport-bind ... iphost 2" sin necesidad. Ver
 * Plan_Implementacion_Tr069_Aplicar_Perfil_Idempotente.md.
 */
describe('applyTr069ManagementWithSession -- camino rápido cuando ya está aplicado', () => {
  const logger = { warn: jest.fn(), log: jest.fn() } as unknown as Logger;
  const onuInterface = 'gpon-onu_1/3/1:3';
  const config: AuthorizeOnuParams = {
    ponInterface: 'gpon-olt_1/3/1',
    onuId: 3,
    modelTypeName: 'HUAWEY-HG8145V5',
    serialNumber: 'TEST00000003',
    serviceVlan: 700,
    managementMethod: 'TR069',
    operationMode: 'ROUTER',
    tr069Url: 'http://10.46.69.1:7547',
    tr069Vlan: 444,
  };

  const transportApplied = [
    `interface ${onuInterface}`,
    '  tcont 1 profile UP-25M',
    '  tcont 2 profile SMARTOLT-VOIPMNG-10M',
    '  gemport 1 tcont 1',
    '  gemport 2 tcont 2',
    '  gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M',
    '  service-port 1 vport 1 user-vlan 700 vlan 700',
    '  service-port 2 vport 2 user-vlan 444 vlan 444',
    '!',
  ].join('\r\n');

  const managementApplied = [
    `pon-onu-mng ${onuInterface}`,
    '  flow 2 switch switch_0/1',
    '  flow mode 2 tag-filter vlan-filter untag-filter discard',
    '  flow 2 pri 2 vlan 444',
    '  gemport 2 flow 2',
    '  switchport-bind switch_0/1 iphost 2',
    '  switchport-bind switch_0/1 veip 1',
    '  ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable',
    '  vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard',
    '  vlan-filter iphost 2 pri 2 vlan 444',
    '  veip 1 port udp 1232 host 2',
    '  tr069-mgmt 1 state unlock',
    '  tr069-mgmt 1 acs http://10.46.69.1:7547',
    '  tr069-mgmt 1 tag pri 2 vlan 444',
    '  security-mgmt 998 state enable mode forward ingress-type lan protocol web https',
    '  security-mgmt 999 state enable ingress-type lan protocol tr069',
    '!',
  ].join('\r\n');

  function buildSession(opts: { transportRaw: string; managementRaw: string; switchportBindRejectsOnce?: boolean }) {
    let switchportBindAttempts = 0;
    const executeCommand = jest.fn().mockImplementation(async (cmd: string) => {
      if (cmd === `show running-config interface ${onuInterface}`) return opts.transportRaw;
      if (cmd === `show onu running config ${onuInterface}`) return opts.managementRaw;
      if (cmd === `show gpon onu detail-info ${onuInterface}`) return 'Config state: success\r\nPhase state: working';
      if (cmd === `show gpon remote-onu ip-host ${onuInterface}`) return 'Host ID: 2\r\nIP address: 192.168.44.10';
      if (opts.switchportBindRejectsOnce && cmd === 'switchport-bind switch_0/1 iphost 2') {
        switchportBindAttempts++;
        return switchportBindAttempts === 1 ? '%Code 63869-GPONRM : Record already exists.' : '';
      }
      return '';
    });
    return { connectAndLogin: jest.fn().mockResolvedValue(undefined), executeCommand, rebootOnu: jest.fn(), close: jest.fn() };
  }

  const delay = jest.fn().mockResolvedValue(undefined);
  beforeEach(() => delay.mockClear());

  it('si transporte Y gestión ya coinciden, no entra a "configure terminal" y responde en una sola lectura de verificación', async () => {
    const session = buildSession({ transportRaw: transportApplied, managementRaw: managementApplied });
    const result = await applyTr069ManagementWithSession(session, config, logger, delay);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('applied_unverified');
    expect(result.evidence.omci.status).toBe('confirmed');
    expect(result.evidence.ip.status).toBe('confirmed');
    expect(result.warning).toBeUndefined();

    const calledCommands = session.executeCommand.mock.calls.map((c: any[]) => c[0]);
    expect(calledCommands).not.toContain('configure terminal');
    expect(calledCommands).not.toContain(`interface ${onuInterface}`);
    expect(calledCommands).not.toContain(`pon-onu-mng ${onuInterface}`);
    expect(calledCommands).not.toContain('write');

    // Sin nada que cambiar (ni comandos de mutación, ni pausa de
    // asentamiento, ni verificación con espera): delay() nunca se llama --
    // la única lectura de verificación es inmediata (pollDelayMs=0 se
    // omite explícitamente, no se traduce en un setTimeout real).
    expect(delay).not.toHaveBeenCalled();
  });

  it('si solo la gestión ya coincide, igual re-cablea el transporte (con su pausa de asentamiento) y omite solo el bloque OMCI', async () => {
    const transportDistinto = transportApplied.replace('service-port 2 vport 2 user-vlan 444 vlan 444', 'service-port 2 vport 2 user-vlan 46 vlan 46');
    const session = buildSession({ transportRaw: transportDistinto, managementRaw: managementApplied });
    const result = await applyTr069ManagementWithSession(session, config, logger, delay);

    expect(result.ok).toBe(true);
    const calledCommands = session.executeCommand.mock.calls.map((c: any[]) => c[0]);
    expect(calledCommands).toContain(`interface ${onuInterface}`);
    expect(calledCommands).toContain('service-port 2 vport 2 user-vlan 444 vlan 444');
    expect(calledCommands).not.toContain(`pon-onu-mng ${onuInterface}`);

    // El transporte sí cambió en esta ejecución -> la pausa de asentamiento (120ms, valor
    // deliberadamente distinto al pacing genérico de "interface"/"pon-onu-mng") aplica.
    expect(delay).toHaveBeenCalledWith(120);
  });

  it('si solo el transporte ya coincide, omite la capa de transporte y re-cablea solo el bloque OMCI, sin la pausa de asentamiento', async () => {
    const managementDistinto = managementApplied.replace('tr069-mgmt 1 tag pri 2 vlan 444', 'tr069-mgmt 1 tag pri 2 vlan 46');
    const session = buildSession({ transportRaw: transportApplied, managementRaw: managementDistinto });
    const result = await applyTr069ManagementWithSession(session, config, logger, delay);

    expect(result.ok).toBe(true);
    const calledCommands = session.executeCommand.mock.calls.map((c: any[]) => c[0]);
    expect(calledCommands).not.toContain(`interface ${onuInterface}`);
    expect(calledCommands).toContain(`pon-onu-mng ${onuInterface}`);
    expect(calledCommands).toContain('tr069-mgmt 1 tag pri 2 vlan 444');
    // Pero sí se mandó el bloque de gestión -> se mantiene la verificación
    // corta de siempre (corta en el primer intento, 500ms, porque el mock
    // ya responde "success" de entrada).
    expect(delay).toHaveBeenCalledWith(500);

    // "120" es el valor EXCLUSIVO de la pausa de asentamiento (distinto a
    // propósito del pacing genérico de comandos) -- confirma que NO se
    // disparó, ya que el transporte no cambió en esta ejecución.
    expect(delay).not.toHaveBeenCalledWith(120);
  });

  it('si ninguno coincide, aplica el comportamiento completo de siempre (transporte + gestión + verificación)', async () => {
    const session = buildSession({ transportRaw: '', managementRaw: '' });
    const result = await applyTr069ManagementWithSession(session, config, logger, delay);

    expect(result.ok).toBe(true);
    const calledCommands = session.executeCommand.mock.calls.map((c: any[]) => c[0]);
    expect(calledCommands).toContain('configure terminal');
    expect(calledCommands).toContain(`interface ${onuInterface}`);
    expect(calledCommands).toContain(`pon-onu-mng ${onuInterface}`);
    // El transporte sí cambió -> pausa de asentamiento (120ms) + pacing de
    // "interface"/"pon-onu-mng" (150ms) + verificación corta (corta en el
    // primer intento, 500ms, porque el mock ya responde "success").
    expect(delay).toHaveBeenCalledWith(120);
    expect(delay).toHaveBeenCalledWith(150);
    expect(delay).toHaveBeenCalledWith(500);
  });

  it('el presupuesto total de pacing (sin contar latencia real de red) queda muy por debajo de los 10s exigidos, incluso en el peor caso (nada aplicado todavía)', async () => {
    const session = buildSession({ transportRaw: '', managementRaw: '' });
    await applyTr069ManagementWithSession(session, config, logger, delay);
    const totalPacingMs = delay.mock.calls.reduce((sum: number, [ms]: [number]) => sum + ms, 0);
    expect(totalPacingMs).toBeLessThanOrEqual(7000);
  });

  it('el reenlace reactivo de "switchport-bind" (red de seguridad si la lectura falló) ahora respeta el pacing entre el "no switchport-bind" y el reintento', async () => {
    // Gestión "distinta" para forzar que SÍ se mande el bloque completo,
    // incluido "switchport-bind switch_0/1 iphost 2", que en este caso
    // simula responder "ya existe" la primera vez (defensivo).
    const managementDistinto = managementApplied.replace('tr069-mgmt 1 tag pri 2 vlan 444', 'tr069-mgmt 1 tag pri 2 vlan 46');
    const session = buildSession({ transportRaw: transportApplied, managementRaw: managementDistinto, switchportBindRejectsOnce: true });
    const result = await applyTr069ManagementWithSession(session, config, logger, delay);

    expect(result.ok).toBe(true);
    const calledCommands = session.executeCommand.mock.calls.map((c: any[]) => c[0]);
    const noBindIdx = calledCommands.indexOf('no switchport-bind switch_0/1 iphost 2');
    expect(noBindIdx).toBeGreaterThanOrEqual(0);
    // BUG REAL corregido (2026-11-06): antes este era el único par de
    // comandos del script enviado sin ninguna pausa entre medio.
    expect(delay).toHaveBeenCalledWith(getTr069PacingDelay('switchport-bind switch_0/1 iphost 2'));
  });
});

/**
 * `previewTr069Plan` debe reflejar EXACTAMENTE lo que `applyTr069Management`
 * enviaría -- antes devolvía siempre el template completo sin leer nada de
 * la OLT pese a etiquetarse como "observed_diff" en el service.
 */
describe('ZteC320Driver.previewTr069Plan -- preview honesto (lee la OLT antes de responder)', () => {
  let driver: ZteC320Driver;
  const onuInterface = 'gpon-onu_1/3/1:3';
  const config: AuthorizeOnuParams = {
    ponInterface: 'gpon-olt_1/3/1',
    onuId: 3,
    modelTypeName: 'HUAWEY-HG8145V5',
    serialNumber: 'TEST00000003',
    serviceVlan: 700,
    managementMethod: 'TR069',
    operationMode: 'ROUTER',
    tr069Url: 'http://10.46.69.1:7547',
    tr069Vlan: 444,
  };
  const params = { host: '10.0.0.10', port: 23, username: 'admin', password: 'password' };

  const transportApplied = [`interface ${onuInterface}`, '  tcont 2 profile SMARTOLT-VOIPMNG-10M', '  gemport 2 tcont 2',
    '  gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M', '  service-port 2 vport 2 user-vlan 444 vlan 444', '!'].join('\r\n');
  const managementApplied = [`pon-onu-mng ${onuInterface}`, '  flow 2 switch switch_0/1',
    '  flow mode 2 tag-filter vlan-filter untag-filter discard', '  flow 2 pri 2 vlan 444', '  gemport 2 flow 2',
    '  switchport-bind switch_0/1 iphost 2', '  switchport-bind switch_0/1 veip 1', '  ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable',
    '  vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard', '  vlan-filter iphost 2 pri 2 vlan 444', '  veip 1 port udp 1232 host 2',
    '  tr069-mgmt 1 state unlock', '  tr069-mgmt 1 acs http://10.46.69.1:7547', '  tr069-mgmt 1 tag pri 2 vlan 444',
    '  security-mgmt 998 state enable mode forward ingress-type lan protocol web https',
    '  security-mgmt 999 state enable ingress-type lan protocol tr069', '!'].join('\r\n');

  beforeEach(() => {
    driver = new ZteC320Driver();
    jest.spyOn<any, any>(driver, 'delay').mockResolvedValue(undefined);
  });

  it('devuelve lista vacía si transporte y gestión ya coinciden con el objetivo', async () => {
    const executeCommand = jest.fn().mockImplementation(async (cmd: string) => {
      if (cmd === `show running-config interface ${onuInterface}`) return transportApplied;
      if (cmd === `show onu running config ${onuInterface}`) return managementApplied;
      return '';
    });
    const close = jest.fn();
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({ connectAndLogin: jest.fn().mockResolvedValue(undefined), executeCommand, close });

    const commands = await driver.previewTr069Plan(params, config);
    expect(commands).toEqual([]);
    expect(close).toHaveBeenCalled();
  });

  it('devuelve solo los comandos del bloque que realmente cambia', async () => {
    const executeCommand = jest.fn().mockImplementation(async (cmd: string) => {
      if (cmd === `show running-config interface ${onuInterface}`) return transportApplied;
      if (cmd === `show onu running config ${onuInterface}`) return ''; // gestión nunca aplicada
      return '';
    });
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({ connectAndLogin: jest.fn().mockResolvedValue(undefined), executeCommand, close: jest.fn() });

    const commands = await driver.previewTr069Plan(params, config);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands).toContain('tr069-mgmt 1 acs http://10.46.69.1:7547');
    expect(commands).not.toContain('tcont 2 profile SMARTOLT-VOIPMNG-10M');
  });

  it('redacta las credenciales ACS si se proporcionaron', async () => {
    const configConCreds: AuthorizeOnuParams = { ...config, tr069AcsUsername: 'acsuser', tr069AcsPassword: 'SECRETO-123' };
    const executeCommand = jest.fn().mockResolvedValue('');
    jest.spyOn<any, any>(driver, 'createSession').mockReturnValue({ connectAndLogin: jest.fn().mockResolvedValue(undefined), executeCommand, close: jest.fn() });

    const commands = await driver.previewTr069Plan(params, configConCreds);
    expect(JSON.stringify(commands)).not.toContain('SECRETO-123');
  });
});
