import * as net from 'net';
import { Injectable, Logger } from '@nestjs/common';
import {
  IOltDriver,
  OltConnectionParams,
  OltSystemInfo,
  OltSystemHealth,
  DiscoveredCard,
  DiscoveredInterface,
  ConfigureVlanParams,
  TcontProfile,
  TrafficProfile,
  VlanTranslationParams,
  OltDriverCapabilities,
  DriverNotImplementedError,
  OltAlarm,
  DiscoveredAuthorizedOnu,
  DiscoveredTcontProfile,
} from '../ports/olt-driver.port';

const VENDOR = 'ZTE';

@Injectable()
export class ZteC320Driver implements IOltDriver {
  private readonly logger = new Logger(ZteC320Driver.name);

  protected createSession(params: OltConnectionParams): {
    connectAndLogin(): Promise<void>;
    executeCommand(cmd: string, timeoutMs?: number): Promise<string>;
    close(): void;
  } {
    return new ZteTelnetSession(params);
  }

  /**
   * Realiza un pre-flight check de conectividad y credenciales Telnet contra la OLT.
   */
  async testConnection(
    params: OltConnectionParams,
  ): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    const start = Date.now();
    let session: any = null;
    try {
      session = this.createSession(params);
      await session.connectAndLogin();
      const latencyMs = Date.now() - start;
      return { ok: true, latencyMs };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Error de conexión Telnet con OLT' };
    } finally {
      if (session) {
        session.close();
      }
    }
  }

  /**
   * Obtiene información general del sistema y firmware (show system-group, show version).
   */
  async getSystemInfo(params: OltConnectionParams): Promise<OltSystemInfo> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const rawSystem = await session.executeCommand('show system-group');
      const rawVersion = await session.executeCommand('show version-running');

      const uptimeMatch = rawSystem.match(/Started before:\s*(.+)/i);
      const uptime = uptimeMatch ? uptimeMatch[1].trim() : '—';

      const versionMatch = rawVersion.match(/V[\d.]+\S*/i) || rawSystem.match(/Software Version:\s*(\S+)/i);
      const firmwareVersion = versionMatch ? versionMatch[0] : 'V1.2.5P3';

      return {
        vendor: 'ZTE',
        model: 'C320',
        uptime,
        firmwareVersion,
        rawSystemGroup: rawSystem.slice(0, 500),
      };
    } finally {
      session.close();
    }
  }

  /**
   * CPU/memoria/temperatura del chasis (RF-OLT-005). Comandos confirmados
   * contra una OLT C320 real en producción (OLT_Tabara_Abajo, 2026-10-17) y
   * respaldados por el manual oficial "ZXA10 C300 Configuration Manual (CLI)"
   * §1.3.5 "Showing Cards" (`show card slotno <N>` expone Cpu-Usage/Mem-Usage/
   * Uptime por tarjeta) y §1.3.9 "Configuring Fans" (`show fan` expone
   * "Environment Temperature"). No existe un único slot "de control" fijo por
   * nombre de tipo -- varía por chasis (SCXN en el manual, SMXA en este
   * equipo real) -- así que se recorren las tarjetas EN SERVICIO devueltas
   * por `show card` y se usa la primera cuyo detalle traiga Cpu-Usage real
   * (las tarjetas sin CPU propio, ej. PRAM, devuelven esos campos vacíos).
   */
  async getSystemHealth(params: OltConnectionParams): Promise<OltSystemHealth> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const cardListOutput = await session.executeCommand('show card');
      const cards = this.parseCards(cardListOutput);

      let cpuUsagePercent: number | undefined;
      let memoryUsagePercent: number | undefined;
      let uptimeSeconds: number | undefined;
      let rawDetail = '';

      for (const card of cards) {
        if (card.status !== 'INSERVICE') continue;
        const detail = await session.executeCommand(`show card slotno ${card.slot}`);
        const cpuMatch = detail.match(/Cpu-Usage\s*:\s*(\d+)%/i);
        const memMatch = detail.match(/Mem-Usage\s*:\s*(\d+)%/i);
        if (!cpuMatch || !memMatch) continue;

        cpuUsagePercent = parseInt(cpuMatch[1], 10);
        memoryUsagePercent = parseInt(memMatch[1], 10);
        const uptimeMatch = detail.match(/Uptime\s*:\s*([^\r\n]+)/i);
        uptimeSeconds = uptimeMatch ? this.parseZteUptimeToSeconds(uptimeMatch[1].trim()) : undefined;
        rawDetail = detail.slice(0, 500);
        break;
      }

      const fanOutput = await session.executeCommand('show fan');
      const tempMatch = fanOutput.match(/Environment Temperature\s*:?\s*(-?\d+)/i);
      const temperatureCelsius = tempMatch ? parseInt(tempMatch[1], 10) : undefined;

      return {
        cpuUsagePercent,
        memoryUsagePercent,
        temperatureCelsius,
        uptimeSeconds,
        raw: rawDetail || fanOutput.slice(0, 500),
      };
    } finally {
      session.close();
    }
  }

  /**
   * Parsea el formato de uptime real de "show card slotno <N>" en este
   * equipo: "122 Days, 3 Hours, 37 Minutes, 13 Seconds" (coincide con el
   * mismo uptime reportado por "show system-group" -- confirmado en vivo).
   */
  private parseZteUptimeToSeconds(raw: string): number | undefined {
    const dayMatch = raw.match(/(\d+)\s*Days?/i);
    const hourMatch = raw.match(/(\d+)\s*Hours?/i);
    const minuteMatch = raw.match(/(\d+)\s*Minutes?/i);
    const secondMatch = raw.match(/(\d+)\s*Seconds?/i);

    if (!dayMatch && !hourMatch && !minuteMatch && !secondMatch) {
      return undefined;
    }

    const days = dayMatch ? parseInt(dayMatch[1], 10) : 0;
    const hours = hourMatch ? parseInt(hourMatch[1], 10) : 0;
    const minutes = minuteMatch ? parseInt(minuteMatch[1], 10) : 0;
    const seconds = secondMatch ? parseInt(secondMatch[1], 10) : 0;

    return days * 86400 + hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Inventario real de tarjetas/slots del chasis (show card). Usa el mismo
   * comando ya verificado en test/fixtures/zte-c320/show_card.txt.
   */
  async getCards(params: OltConnectionParams): Promise<DiscoveredCard[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const output = await session.executeCommand('show card');
      return this.parseCards(output);
    } finally {
      session.close();
    }
  }

  private parseCards(output: string): DiscoveredCard[] {
    const cards: DiscoveredCard[] = [];
    const rowMatches = output.matchAll(
      /^\s*\d+\s+\d+\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/gm,
    );

    for (const m of rowMatches) {
      cards.push({
        slot: parseInt(m[1], 10),
        cardType: m[2],
        realType: m[3],
        portCount: parseInt(m[4], 10),
        hardVer: m[5],
        softVer: m[6],
        status: m[7],
      });
    }

    return cards;
  }

  /**
   * Descubre las interfaces activas (show card + show interface gpon-olt_1/X/Y).
   */
  async discoverInterfaces(params: OltConnectionParams): Promise<DiscoveredInterface[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const cardOutput = await session.executeCommand('show card');
      const interfaces: DiscoveredInterface[] = [];

      // Detectar slots GPON/EPON reusando el MISMO parser ya verificado que
      // usa getCards()/getSystemHealth() (parseCards()). Este método tenía su
      // propia regex ad-hoc que desalineaba las 3 columnas numéricas
      // iniciales de "show card" (Rack/Shelf/Slot) -- confundía Shelf con
      // Slot y RealType con Status, así que NUNCA reconocía una tarjeta real
      // como "INSERVICE" y siempre caía al fallback hardcodeado (slot 1,
      // GTGO, 8 puertos) -- bug real confirmado en vivo contra OLT_Tabara_Abajo
      // (tarjeta GPON real: slot 2, tipo GTGH, 16 puertos; "0 puertos
      // detectados" en el escaneo). El número de puertos tampoco se adivina
      // más: se usa `portCount` real de la tabla, no una tabla fija GTGO=8/resto=16.
      const cards = this.parseCards(cardOutput);
      const gponSlots: Array<{ slot: number; cardType: string; ports: number }> = [];

      for (const card of cards) {
        if (card.status.toUpperCase() !== 'INSERVICE') continue;
        const cardType = card.cardType.toUpperCase();
        if (cardType.startsWith('GTG') || cardType.startsWith('GFG')) {
          gponSlots.push({ slot: card.slot, cardType, ports: card.portCount });
        }
      }

      // Último recurso real (equipo simulado/sin tarjetas detectables) -- no
      // debería dispararse nunca contra un chasis real con parseCards() ya
      // funcionando correctamente.
      if (gponSlots.length === 0) {
        this.logger.warn('No se detectó ninguna tarjeta GPON/EPON "INSERVICE" en "show card" -- usando slot 1/GTGO/8 puertos como último recurso.');
        gponSlots.push({ slot: 1, cardType: 'GTGO', ports: 8 });
      }

      // Escanear puertos GPON
      for (const { slot, ports } of gponSlots) {
        for (let port = 1; port <= ports; port++) {
          const ifaceName = `gpon-olt_1/${slot}/${port}`;
          try {
            const ifaceOut = await session.executeCommand(`show interface ${ifaceName}`, 15000);
            if (ifaceOut.includes('Invalid') || !ifaceOut.includes('gpon-olt')) {
              continue;
            }

            const adminState = ifaceOut.includes('administratively down') ? 'DOWN' : 'UP';
            const operState = ifaceOut.includes('line protocol is down') ? 'DOWN' : 'UP';

            const onusMatch = ifaceOut.match(/registered onus is (\d+)/i);
            const registeredOnus = onusMatch ? parseInt(onusMatch[1], 10) : 0;

            const inMatch = ifaceOut.match(/Input rate\s*:\s*(\d+)\s*Bps/i);
            const outMatch = ifaceOut.match(/Output rate\s*:\s*(\d+)\s*Bps/i);

            interfaces.push({
              name: ifaceName,
              type: 'PON',
              slot,
              port,
              adminState,
              operState,
              registeredOnus,
              inputBps: inMatch ? parseInt(inMatch[1], 10) : 0,
              outputBps: outMatch ? parseInt(outMatch[1], 10) : 0,
            });
          } catch (err: any) {
            this.logger.warn(`Error inspeccionando ${ifaceName}: ${err.message}`);
          }
        }
      }

      // Descubrir uplinks GEI reales -- antes era hardcodeado (slot 3 fijo,
      // 4 puertos fijos, estado "UP" inventado sin consultar nada). Bug real
      // confirmado en vivo contra OLT_Tabara_Abajo: "show interface ?" en ese
      // equipo nunca lista "gei_1/3" (la tarjeta PRAM de ese slot no expone
      // interfaces GEI) -- el uplink real es "gei_1/4/1" (tarjeta SMXA, con
      // tráfico real) y el rango de puertos es el portCount real de esa
      // tarjeta en "show card" (3 en este equipo), no un 4 fijo. Se recorren
      // las tarjetas EN SERVICIO que no sean GPON/EPON (esas ya se cubrieron
      // arriba) y se consulta cada puerto real; si el comando devuelve un
      // error del equipo ("%Error <código>: ..."), ese puerto no existe y se
      // omite sin inventar nada.
      for (const card of cards) {
        if (card.status.toUpperCase() !== 'INSERVICE') continue;
        const cardType = card.cardType.toUpperCase();
        if (cardType.startsWith('GTG') || cardType.startsWith('GFG')) continue;

        for (let port = 1; port <= card.portCount; port++) {
          const ifaceName = `gei_1/${card.slot}/${port}`;
          try {
            const ifaceOut = await session.executeCommand(`show interface ${ifaceName}`, 15000);
            if (/%Error\s+\d+:/i.test(ifaceOut) || !ifaceOut.includes(ifaceName)) {
              continue;
            }

            const adminState = new RegExp(`${ifaceName}\\s+is\\s+up`, 'i').test(ifaceOut) ? 'UP' : 'DOWN';
            const operState = /line protocol is\s+up/i.test(ifaceOut) ? 'UP' : 'DOWN';

            const inMatch = ifaceOut.match(/input rate\s*:\s*(\d+)\s*Bps/i);
            const outMatch = ifaceOut.match(/output rate\s*:\s*(\d+)\s*Bps/i);

            interfaces.push({
              name: ifaceName,
              type: 'UPLINK',
              slot: card.slot,
              port,
              adminState,
              operState,
              inputBps: inMatch ? parseInt(inMatch[1], 10) : undefined,
              outputBps: outMatch ? parseInt(outMatch[1], 10) : undefined,
            });
          } catch (err: any) {
            this.logger.warn(`Error inspeccionando uplink ${ifaceName}: ${err.message}`);
          }
        }
      }

      return interfaces;
    } finally {
      session.close();
    }
  }

  /**
   * Configura una VLAN en una interfaz física (ej: Uplink GEI) con modo TAG (RF-OLT-012).
   */
  async configureVlanOnInterface(
    params: OltConnectionParams,
    config: ConfigureVlanParams,
  ): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();

      // 1. Entrar en modo de configuración
      await session.executeCommand('configure terminal');

      // 2. Garantizar que la VLAN exista en la OLT
      await session.executeCommand(`vlan ${config.vlanId}`);
      await session.executeCommand('exit');

      // 3. Entrar a la interfaz y aplicar VLAN
      await session.executeCommand(`interface ${config.interfaceName}`);
      if (config.mode === 'TAG') {
        await session.executeCommand(`switchport vlan ${config.vlanId} tag`);
      } else {
        await session.executeCommand(`switchport vlan ${config.vlanId} untag`);
      }
      await session.executeCommand('exit');

      // 4. Guardar cambios en memoria NVRAM
      await session.executeCommand('write');

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      session.close();
    }
  }

  /**
   * Expande una lista de VLANs tal como la reporta "show vlan port" --
   * confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19) que viene en
   * formato "1,46,400-405,700" (coma-separado, CON rangos con guión) y no
   * solo números individuales como sugerían los únicos ejemplos del manual
   * oficial (todos de 1 sola VLAN). Si no se expanden los rangos, "400-405"
   * se interpretaría como solo "400" y "401-404" se perdería silenciosamente.
   */
  private parseVlanList(text: string): number[] {
    const result: number[] = [];
    for (const token of text.split(',')) {
      const trimmed = token.trim();
      if (!trimmed) continue;
      const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        for (let v = start; v <= end && v - start < 4094; v++) {
          result.push(v);
        }
        continue;
      }
      const single = parseInt(trimmed, 10);
      if (!Number.isNaN(single)) {
        result.push(single);
      }
    }
    return result;
  }

  /**
   * VLANs REALES (tag/untag) ya configuradas en una interfaz física, vía
   * "show vlan port <interfaz>" -- confirmado en vivo contra OLT_Tabara_Abajo
   * en los puertos uplink (gei_1/4/1) y PON (gpon-olt_1/2/1, siempre vacío
   * ahí porque el modo access de los puertos PON maneja VLANs por
   * service-port, no por este mecanismo de trunk). Ver `vlanDiscovery` en
   * OltDriverCapabilities.
   */
  async getVlanConfigForInterface(
    params: OltConnectionParams,
    interfaceName: string,
  ): Promise<import('../ports/olt-driver.port').DiscoveredInterfaceVlan[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const output = await session.executeCommand(`show vlan port ${interfaceName}`);

      if (/%Error/i.test(output)) {
        throw new Error(`La OLT rechazó la interfaz "${interfaceName}": ${output.trim()}`);
      }

      // Ancladas a inicio de línea (^ con /m): "UntaggedVlan:" contiene
      // literalmente la subcadena "TaggedVlan:" (Un+TaggedVlan:), así que un
      // regex sin anclar hace match ahí primero por error y nunca llega a la
      // línea real "TaggedVlan:" -- confirmado con el fixture real, donde
      // esto hacía desaparecer la primera VLAN de la lista en silencio.
      // Además captura "hasta el final" (no solo la primera línea): una
      // lista larga puede envolverse en varias líneas de la terminal sin
      // marcador de continuación -- parseVlanList() no se confunde con
      // saltos de línea embebidos (split(',') + trim por token).
      const untaggedMatch = output.match(/^UntaggedVlan:[ \t]*([\s\S]*?)^[ \t]*TaggedVlan:/im);
      const taggedMatch = output.match(/^TaggedVlan:[ \t]*([\s\S]*)$/im);

      const untagged = untaggedMatch ? this.parseVlanList(untaggedMatch[1]) : [];
      const tagged = taggedMatch ? this.parseVlanList(taggedMatch[1]) : [];

      const result: import('../ports/olt-driver.port').DiscoveredInterfaceVlan[] = [];
      for (const vlanId of untagged) result.push({ vlanId, mode: 'UNTAG' });
      for (const vlanId of tagged) result.push({ vlanId, mode: 'TAG' });
      return result;
    } finally {
      session.close();
    }
  }

  /**
   * Obtiene la lista de ONUs no autorizadas descubiertas (RF-OLT-014).
   * Ejecuta `show gpon onu uncfg [ponInterface]`.
   */
  async getUnconfiguredOnus(
    params: OltConnectionParams,
    ponInterface?: string,
  ): Promise<import('../ports/olt-driver.port').DiscoveredUncfgOnu[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const cmd = ponInterface ? `show gpon onu uncfg ${ponInterface}` : 'show gpon onu uncfg';
      const output = await session.executeCommand(cmd);

      const results: import('../ports/olt-driver.port').DiscoveredUncfgOnu[] = [];
      const lines = output.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // Coincide con formato: "gpon-onu_1/1/1:1       ZTEGC0123456"
        const match = trimmed.match(/^(gpon-onu_(\d+\/\d+\/\d+):(\d+))\s+([A-Za-z0-9]+)/i);
        if (match) {
          const onuIndex = match[1];
          const ponIface = `gpon-olt_${match[2]}`;
          const serialNumber = match[4];

          results.push({
            ponInterface: ponIface,
            onuIndex,
            serialNumber,
            vendor: this.inferVendorFromSerial(serialNumber),
          });
        }
      }

      return results;
    } finally {
      session.close();
    }
  }

  private inferVendorFromSerial(serialNumber: string): string {
    const upperSn = serialNumber.toUpperCase();
    if (upperSn.startsWith('ZTEG')) return 'ZTE';
    if (upperSn.startsWith('HWTC')) return 'Huawei';
    if (upperSn.startsWith('VSOL')) return 'VSOL';
    if (upperSn.startsWith('ALCL')) return 'Nokia/Alcatel';
    if (upperSn.startsWith('FHTT')) return 'Fiberhome';
    return 'Desconocido';
  }

  /**
   * Importación pasiva de ONUs ya autorizadas/aprovisionadas en un puerto PON
   * (RF: incorporar un sitio con clientes en producción de otro sistema sin
   * re-emitir el CLI de autorización). Comandos confirmados en vivo contra
   * OLT_Tabara_Abajo (2026-10-17):
   * - "show gpon onu baseinfo <puerto>" -- UNA sola consulta por puerto,
   *   trae el serial real de TODAS las ONUs del puerto ("AuthInfo: SN:...").
   *   El tipo/modelo puede partirse en una segunda línea si el nombre es
   *   largo (ej. "HUAWEY-BT54\n  6XG") -- no afecta el parseo porque cada
   *   fila real empieza con el índice completo "gpon-onu_...".
   * - "show gpon onu state <puerto>" -- estado admin/fase real por ONU
   *   (columna 1 sin el prefijo "gpon-onu_", ej. "1/2/1:1").
   * Deliberadamente NO se usa "show onu running config" aquí: en este equipo
   * real esas ONUs están gestionadas por OMCI puro (bloque "pon-onu-mng"),
   * que no incluye serial ni VLAN de servicio en un formato parseable sin
   * inventar -- el serial ya viene de "baseinfo", y VLAN/perfil quedan para
   * que el operador los configure al vincular la ONU a un contrato.
   */
  async getAuthorizedOnus(
    params: OltConnectionParams,
    ponInterface: string,
  ): Promise<DiscoveredAuthorizedOnu[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();

      // Timeout muy generoso (bug real confirmado en producción, 2026-10-17,
      // OLT_Tabara_Abajo): en una conexión aislada este comando tarda 1-2s
      // incluso con varias páginas "--More--" (confirmado contra puertos con
      // 50+ ONUs). Los timeouts reales en producción coincidieron con las
      // ventanas de los cron de monitoreo (cada 5 min, sondean la misma OLT)
      // -- probable contención del event loop de Node, no lentitud real del
      // equipo ni de la paginación. Es una acción deliberada del operador
      // (importar un puerto puntual), no un sondeo frecuente, así que se
      // tolera bastante margen en vez de intentar resolver la contención aquí.
      const baseInfoOutput = await session.executeCommand(`show gpon onu baseinfo ${ponInterface}`, 180000);
      if (/%Error\s+\d+:/i.test(baseInfoOutput)) {
        throw new Error(`La OLT no reconoce el puerto PON "${ponInterface}".`);
      }

      const baseRows = new Map<string, { onuType: string; serialNumber: string }>();
      const baseMatches = baseInfoOutput.matchAll(/^(gpon-onu_\d+\/\d+\/\d+:\d+)\s+(\S+)\s+sn\s+SN:(\S+)/gim);
      for (const m of baseMatches) {
        baseRows.set(m[1], { onuType: m[2], serialNumber: m[3] });
      }

      const stateRows = new Map<string, { adminState: 'ENABLE' | 'DISABLE'; phaseState: string }>();
      try {
        const stateOutput = await session.executeCommand(`show gpon onu state ${ponInterface}`, 180000);
        const stateMatches = stateOutput.matchAll(/^(\d+\/\d+\/\d+:\d+)\s+(enable|disable)\s+\S+\s+(\S+)/gim);
        for (const m of stateMatches) {
          stateRows.set(`gpon-onu_${m[1]}`, {
            adminState: m[2].toUpperCase() as 'ENABLE' | 'DISABLE',
            phaseState: m[3],
          });
        }
      } catch (err: any) {
        this.logger.warn(`No se pudo leer "show gpon onu state ${ponInterface}": ${err.message}`);
      }

      const discovered: DiscoveredAuthorizedOnu[] = [];
      for (const [onuIndex, base] of baseRows) {
        const state = stateRows.get(onuIndex);
        discovered.push({
          ponInterface,
          onuIndex,
          serialNumber: base.serialNumber,
          vendor: this.inferVendorFromSerial(base.serialNumber),
          onuType: base.onuType,
          adminState: state?.adminState || 'ENABLE',
          phaseState: state?.phaseState,
        });
      }

      return discovered;
    } finally {
      session.close();
    }
  }

  /**
   * Consulta los niveles de potencia óptica RX/TX de una ONU (RF-OLT-015).
   * Ejecuta `show pon power attenuation gpon-onu_X:Y`.
   */
  async getOnuOpticalPower(
    params: OltConnectionParams,
    onuTarget: string,
  ): Promise<import('../ports/olt-driver.port').OnuOpticalPower> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const output = await session.executeCommand(`show pon power attenuation ${onuTarget}`);

      // Parser para ZTE C320:
      // down Rx :-19.80(dbm)      Tx:2.50(dbm)
      // up   Rx :-21.45(dbm)      Tx:2.15(dbm)
      const downMatch = output.match(/down\s+Rx\s*:\s*([-\d.]+)\s*\(dbm\)\s+Tx\s*:\s*([-\d.]+)\s*\(dbm\)/i);
      const upMatch = output.match(/up\s+Rx\s*:\s*([-\d.]+)\s*\(dbm\)\s+Tx\s*:\s*([-\d.]+)\s*\(dbm\)/i);
      const attMatch = output.match(/attenuation\s*:\s*([-\d.]+)\s*\(dB\)/i);

      const downRx = downMatch ? parseFloat(downMatch[1]) : undefined;
      const upRx = upMatch ? parseFloat(upMatch[1]) : undefined;
      const tx = downMatch ? parseFloat(downMatch[2]) : undefined;
      const att = attMatch ? parseFloat(attMatch[1]) : undefined;

      return {
        rxDbm: downRx,
        txDbm: tx,
        downRxDbm: downRx,
        upRxDbm: upRx,
        attenuationDb: att,
        raw: output.slice(0, 300),
      };
    } finally {
      session.close();
    }
  }

  /**
   * Genera la lista de comandos Telnet de autorización y aprovisionamiento (RF-OLT-016 / RF-ONU-001..007).
   */
  generateAuthorizationScript(config: import('../ports/olt-driver.port').AuthorizeOnuParams): string[] {
    const commands: string[] = [
      'configure terminal',
      `interface ${config.ponInterface}`,
      `onu ${config.onuId} type ${config.modelTypeName} sn ${config.serialNumber}`,
      'exit',
      `interface ${config.ponInterface}:${config.onuId}`,
      `name ${config.clientName ? config.clientName.replace(/\s+/g, '_') : `ONU-${config.onuId}`}`,
      `tcont 1 profile ${config.tcontProfile || 'SMARTOLT-100M-UP'}`,
      'gemport 1 tcont 1',
      'switchport mode hybrid vport 1',
      `service-port 1 vport 1 user-vlan ${config.serviceVlan} vlan ${config.serviceVlan}`,
    ];

    // Aplica el traffic-profile de bajada al vport (§7.3.11 del manual del
    // C300) -- "direction egress" porque, desde la óptica de la interfaz de
    // la ONU, "egress" es el tráfico que SALE de la OLT hacia la ONU, osea
    // el sentido de bajada hacia el cliente.
    if (config.trafficProfile) {
      commands.push(`traffic-profile ${config.trafficProfile} vport 1 direction egress`);
    }

    commands.push('exit');

    if (config.managementMethod === 'TR069' && config.tr069Url) {
      commands.push(
        `pon-onu-mng ${config.ponInterface}:${config.onuId}`,
        `tr069-mgmt 1 acs ${config.tr069Url} tag pri 2 vlan ${config.tr069Vlan || config.serviceVlan}`,
        // "end", NO "exit": todos los ejemplos reales del manual (ZXA10 C300
        // Configuration Manual CLI, ej. §2.11/2.12/2.13) salen de
        // "(gpon-onu-mng)#" con "end" -- usar "exit" ahí dispara el prompt
        // interactivo "Confirm to logout without saving? [yes/no]:" que este
        // driver no sabe responder, y la sesión se cuelga hasta el timeout
        // (confirmado en producción: ONU CMDCDD4D131E / OLT_Tabara_Abajo,
        // 2026-10-19).
        'end',
      );
    }

    commands.push('write');
    return commands;
  }

  /**
   * Ejecuta el aprovisionamiento de la ONU en la OLT. Antes de correr el
   * script generado, asegura que el perfil TCONT referenciado
   * (`config.tcontProfile`) exista de verdad en la OLT — antes de esto,
   * `generateAuthorizationScript()` solo lo referenciaba por nombre
   * (`tcont 1 profile <nombre>`) asumiendo silenciosamente que ya existía;
   * si no existía, la autorización fallaba sin explicación clara. Solo
   * aplica si hay `tcontProfile` + `upKbps` (TCONT es ancho de banda de
   * SUBIDA en GPON — ver `ensureTcontProfile`, el ancho de banda de bajada
   * no se gestiona por esta vía).
   */
  async authorizeOnu(
    params: OltConnectionParams,
    config: import('../ports/olt-driver.port').AuthorizeOnuParams,
  ): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();

      if (config.tcontProfile && config.upKbps) {
        await this.ensureTcontProfileWithSession(session, { name: config.tcontProfile, fixedKbps: config.upKbps });
      }

      if (config.trafficProfile && config.downKbps) {
        await this.ensureTrafficProfileWithSession(session, { name: config.trafficProfile, downKbps: config.downKbps });
      }

      const commands = this.generateAuthorizationScript(config);

      for (const cmd of commands) {
        await session.executeCommand(cmd);
      }

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      session.close();
    }
  }

  /**
   * Busca un perfil TCONT por nombre vía `show gpon profile tcont`.
   * Reutiliza el mismo parser que `getTcontProfiles()` (confirmado en vivo
   * contra OLT_Tabara_Abajo, 2026-10-19) en vez del viejo heurístico
   * "busca la palabra 'fixed' cerca del nombre", que nunca coincidía con el
   * formato real (columnas Type/FBW/ABW/MBW, sin la palabra "fixed" en
   * ningún lado de la salida de `show`).
   */
  async findTcontProfileByName(params: OltConnectionParams, name: string): Promise<TcontProfile | null> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const output = await session.executeCommand('show gpon profile tcont');
      const found = this.parseTcontProfilesFromOutput(output).find((p) => p.name === name);
      return found ? { name: found.name, fixedKbps: found.speedKbps } : null;
    } finally {
      session.close();
    }
  }

  private parseTcontProfilesFromOutput(output: string): DiscoveredTcontProfile[] {
    // "Profile name :<nombre>" seguido (con ruido de paginación/backspace
    // posible en medio) de la fila de datos "Type FBW ABW MBW PRIORITY
    // WEIGHT" -- se salta de forma perezosa hasta la primera fila que calce
    // el patrón numérico real, sin depender del texto exacto de la cabecera
    // (que puede variar o llegar fragmentado por "--More--").
    const profileRegex = /Profile name\s*:\s*(\S+)[\s\S]*?\r?\n\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)/g;
    const results: DiscoveredTcontProfile[] = [];
    let match: RegExpExecArray | null;
    while ((match = profileRegex.exec(output)) !== null) {
      const [, name, type, fbw, abw, mbw] = match;
      const fbwKbps = parseInt(fbw, 10);
      const abwKbps = parseInt(abw, 10);
      const mbwKbps = parseInt(mbw, 10);
      results.push({
        name,
        type: parseInt(type, 10),
        fbwKbps,
        abwKbps,
        mbwKbps,
        speedKbps: Math.max(fbwKbps, abwKbps, mbwKbps),
      });
    }
    return results;
  }

  /**
   * Crea el perfil TCONT tipo 5 (Fixed + Assured + Maximum) si no existe --
   * CONFIRMADO EN VIVO contra OLT_Tabara_Abajo (2026-10-19) con un perfil de
   * prueba ("SUMTECH-TEST-DELETE-ME"), creado y eliminado limpiamente:
   *   configure terminal / gpon / profile tcont <nombre> type 5 fixed 64
   *   assured 64 maximum <kbps> / exit / exit / write
   * FBW=64 y ABW=64 replican exactamente la convención real que usan los
   * ~40 perfiles "SMARTOLT-*-UP" ya configurados en esta OLT (ver
   * `getTcontProfiles`) -- no son valores inventados.
   *
   * Reemplaza la versión anterior ("type 1 fixed <kbps>", sin entrar antes
   * a "configure terminal"+"gpon"): esa sintaxis era incompatible con el
   * "type 5" real y, además, nunca entraba al submodo de configuración
   * correcto -- nunca se había probado en vivo hasta ahora.
   *
   * IMPORTANTE — alcance: TCONT en GPON gobierna el ancho de banda de
   * SUBIDA del ONU únicamente (ITU-T G.984). El ancho de banda de BAJADA
   * se gestiona con un mecanismo aparte -- ver `ensureTrafficProfile` más
   * abajo, que sí lo cubre usando `net.olt_speed_profiles.vendor_traffic_profile`.
   * No asumir que crear el TCONT ya configuró la velocidad completa del
   * cliente en ambos sentidos: para eso hacen falta AMBOS métodos.
   */
  async ensureTcontProfile(params: OltConnectionParams, profile: TcontProfile): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await this.ensureTcontProfileWithSession(session, profile);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      session.close();
    }
  }

  private async ensureTcontProfileWithSession(
    session: { executeCommand(cmd: string, timeoutMs?: number): Promise<string> },
    profile: TcontProfile,
  ): Promise<void> {
    const output = await session.executeCommand('show gpon profile tcont');
    const existing = this.parseTcontProfilesFromOutput(output).find((p) => p.name === profile.name);
    if (existing) {
      return;
    }
    await session.executeCommand('configure terminal');
    await session.executeCommand('gpon');
    await session.executeCommand(`profile tcont ${profile.name} type 5 fixed 64 assured 64 maximum ${profile.fixedKbps}`);
    await session.executeCommand('exit');
    await session.executeCommand('exit');
    await session.executeCommand('write');
  }

  /**
   * Crea (o redeclara) el traffic-profile de BAJADA (CIR=PIR=downKbps) --
   * CONFIRMADO EN VIVO contra OLT_Tabara_Abajo (2026-10-19) con un perfil de
   * prueba ("SUMTECH-TEST-DELETE-ME"), creado y eliminado limpiamente:
   *   configure terminal / traffic-profile <nombre> ip cir <kbps> cbs 1000
   *   pir <kbps> pbs 1000 / exit / write
   * A diferencia de TCONT, este comando NO entra a un submodo "gpon" -- se
   * manda directo en "(config)#". CIR=PIR (sin distinguir tasa comprometida
   * de tasa pico) porque no hay todavía una política de negocio para dar
   * margen de ráfaga por encima del plan contratado -- si se necesita,
   * ajustar aquí.
   *
   * IMPORTANTE -- por qué NO hay chequeo de existencia previo (a diferencia
   * de ensureTcontProfileWithSession): "show traffic-profile <nombre>",
   * documentado en el manual oficial (§7.3.11), NO EXISTE en este firmware
   * -- confirmado en vivo: responde "%Error 20201: Invalid input detected"
   * tanto desde "(config)#" como desde "(config-if)#". En su lugar, se
   * confirmó en vivo que redeclarar el MISMO nombre con los mismos
   * parámetros es en sí mismo silencioso/idempotente (sin error), así que
   * el comando de creación DOBLA como "ensure" sin necesitar una consulta
   * previa. No usar "show running-config" como verificación aquí: se probó
   * y la salida es demasiado grande/paginada para un timeout razonable
   * contra esta OLT real (quedó colgado >90s en una prueba).
   */
  async ensureTrafficProfile(params: OltConnectionParams, profile: TrafficProfile): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await this.ensureTrafficProfileWithSession(session, profile);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      session.close();
    }
  }

  private async ensureTrafficProfileWithSession(
    session: { executeCommand(cmd: string, timeoutMs?: number): Promise<string> },
    profile: TrafficProfile,
  ): Promise<void> {
    await session.executeCommand('configure terminal');
    await session.executeCommand(
      `traffic-profile ${profile.name} ip cir ${profile.downKbps} cbs 1000 pir ${profile.downKbps} pbs 1000`,
    );
    await session.executeCommand('exit');
    await session.executeCommand('write');
  }

  /**
   * Lista TODOS los perfiles TCONT reales configurados en la OLT, vía
   * "show gpon profile tcont" -- confirmado en vivo contra OLT_Tabara_Abajo
   * (2026-10-19): ~40 perfiles reales, con nombres que ya coinciden con la
   * convención del catálogo de Sumtech (ej. "SMARTOLT-100M-UP"). El formato
   * real coincide con el documentado en el manual oficial (§2, Tabla 2-4/2-5):
   * columnas Type/FBW(kbps)/ABW(kbps)/MBW(kbps) por perfil.
   *
   * IMPORTANTE -- este descubrimiento fue lo que expuso el bug corregido en
   * `ensureTcontProfileWithSession` (antes creaba perfiles "type 1 fixed",
   * incompatible con la convención real): casi todos los perfiles reales de
   * producción son **type 5** (Fixed + Assured + Maximum, los 3 valores a la
   * vez) -- el manual confirma en sus propios ejemplos que la velocidad
   * "nombrada" de un perfil siempre coincide con `max(FBW, ABW, MBW)` sin
   * importar el type (type 1 "2M" → FBW=2000; type 5 "20M" →
   * fixed=2000/assured=5000/maximum=20000, nombre coincide con el máximo).
   * Por eso `speedKbps` abajo usa ese mismo criterio en vez de asumir un
   * campo fijo por type.
   */
  async getTcontProfiles(params: OltConnectionParams): Promise<DiscoveredTcontProfile[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const output = await session.executeCommand('show gpon profile tcont');
      return this.parseTcontProfilesFromOutput(output);
    } finally {
      session.close();
    }
  }

  /**
   * Solo se confirmó el NOMBRE de este comando en documentación pública
   * ("vlan-translate ingress-port", manual de VLAN translation/Smart QinQ
   * del ZTE C300/C320) — sin un ejemplo completo de sintaxis (orden de
   * argumentos, modo de configuración exacto). Implementarlo con esa
   * evidencia parcial sería inventar el resto del comando, así que sigue
   * señalando DRIVER_NOT_IMPLEMENTED hasta tener el ejemplo completo
   * (documentado o por reconocimiento en vivo).
   */
  async configureVlanTranslation(params: OltConnectionParams, config: VlanTranslationParams): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: new DriverNotImplementedError(VENDOR, 'configureVlanTranslation').message };
  }

  /** Sin reconocimiento real todavía de un comando de log/alarmas para C320 -- ver `alarms` en OltDriverCapabilities. */
  async getAlarms(params: OltConnectionParams): Promise<OltAlarm[]> {
    throw new DriverNotImplementedError(VENDOR, 'getAlarms');
  }

  /**
   * Bloquea o reactiva una ONU en la OLT mediante shutdown / no shutdown (RF-OLT-017).
   */
  async setOnuAdminState(
    params: OltConnectionParams,
    onuTarget: string,
    state: 'ACTIVE' | 'BLOCKED',
  ): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await session.executeCommand('configure terminal');
      await session.executeCommand(`interface ${onuTarget}`);
      if (state === 'BLOCKED') {
        await session.executeCommand('shutdown');
      } else {
        await session.executeCommand('no shutdown');
      }
      await session.executeCommand('exit');
      await session.executeCommand('write');

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      session.close();
    }
  }

  /**
   * Elimina el registro de una ONU en la OLT (RF-OLT-016 desautorización).
   */
  async deleteOnu(
    params: OltConnectionParams,
    ponInterface: string,
    onuId: number,
  ): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await session.executeCommand('configure terminal');
      await session.executeCommand(`interface ${ponInterface}`);
      await session.executeCommand(`no onu ${onuId}`);
      await session.executeCommand('exit');
      await session.executeCommand('write');

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      session.close();
    }
  }

  /**
   * "shutdown"/"no shutdown" sobre la interfaz indicada — mismo mecanismo ya
   * confirmado en producción vía `setOnuAdminState()`, aplicado aquí a una
   * interfaz física completa (puerto PON o uplink) en vez de a la
   * sub-interfaz virtual de un ONU individual. Apagar un puerto PON corta a
   * TODOS los ONUs de ese puerto, no a uno solo.
   */
  async setInterfaceAdminState(
    params: OltConnectionParams,
    interfaceName: string,
    state: 'UP' | 'DOWN',
  ): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await session.executeCommand('configure terminal');
      await session.executeCommand(`interface ${interfaceName}`);
      if (state === 'DOWN') {
        await session.executeCommand('shutdown');
      } else {
        await session.executeCommand('no shutdown');
      }
      await session.executeCommand('exit');
      await session.executeCommand('write');

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      session.close();
    }
  }

  async getRunningConfig(params: OltConnectionParams): Promise<string> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await session.executeCommand('show running-config', 20000);
    } finally {
      session.close();
    }
  }

  async getInterfaceTraffic(
    params: OltConnectionParams,
    interfaceName: string,
  ): Promise<{ rxKbps: number; txKbps: number; rawBps?: { inputBps: number; outputBps: number } }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const ifaceOut = await session.executeCommand(`show interface ${interfaceName}`, 15000);
      const inMatch = ifaceOut.match(/Input rate\s*:\s*(\d+)\s*Bps/i);
      const outMatch = ifaceOut.match(/Output rate\s*:\s*(\d+)\s*Bps/i);
      const inBps = inMatch ? parseInt(inMatch[1], 10) : 0;
      const outBps = outMatch ? parseInt(outMatch[1], 10) : 0;
      return {
        rxKbps: Math.round((inBps * 8) / 1000),
        txKbps: Math.round((outBps * 8) / 1000),
        rawBps: { inputBps: inBps, outputBps: outBps },
      };
    } finally {
      session.close();
    }
  }

  getCapabilities(): OltDriverCapabilities {
    return {
      testConnection: true,
      systemInfo: true,
      systemHealth: true,
      chassisCards: true,
      discoverInterfaces: true,
      configureVlan: true,
      onuDiscovery: true,
      onuOpticalPower: true,
      onuAuthorize: true,
      onuAdminState: true,
      onuDelete: true,
      interfaceAdminState: true,
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19): se creó y
      // eliminó un perfil TCONT de prueba real ("SUMTECH-TEST-DELETE-ME",
      // type 5 fixed/assured/maximum) con el flujo completo configure
      // terminal/gpon/profile tcont/exit/exit/write -- ver ensureTcontProfile.
      dbaProfile: true,
      // vlanTranslation sigue sin evidencia completa -- ver configureVlanTranslation.
      vlanTranslation: false,
      alarms: false,
      tr069AutoProvisioning: false,
      onuPassiveImport: true,
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19): "show vlan
      // port <interfaz>" responde con datos reales tanto en uplink
      // (gei_1/4/1) como en PON (gpon-olt_1/2/1).
      vlanDiscovery: true,
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19): "show gpon
      // profile tcont" responde con ~40 perfiles reales ya configurados.
      tcontDiscovery: true,
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19): se creó y
      // eliminó un traffic-profile de prueba real ("SUMTECH-TEST-DELETE-ME")
      // con el flujo completo configure terminal/traffic-profile/exit/write
      // -- ver ensureTrafficProfile().
      downstreamTrafficProfile: true,
    };
  }

  getCapabilityNotes(): Partial<Record<keyof OltDriverCapabilities, string>> {
    return {
      tr069AutoProvisioning:
        'El driver ya envía "tr069-mgmt" al autorizar (sintaxis de documentación pública del C320), pero no se ha confirmado contra un equipo real -- mismo criterio aplicado a vlanTranslation en este driver.',
    };
  }
}

/**
 * Sesión Telnet de bajo nivel para ZTE C320 con protocolo IAC (RFC 854),
 * bypass de paginación (--More--), saneamiento ANSI y detección de prompts.
 */
export class ZteTelnetSession {
  private socket: net.Socket | null = null;
  private prompt = 'ZXAN#';
  private buffer = '';
  // Instrumentación temporal (RF: bug real en producción, 2026-10-17 --
  // "show gpon onu baseinfo" se cuelga completo en algunos puertos incluso
  // ya serializado por OLT -- ver withOltTelnetLock -- y confirmado que la
  // OLT responde normal en 1-2s cuando se prueba aislado inmediatamente
  // después de la falla real. Sin visibilidad de HASTA DÓNDE llega la
  // sesión real que se cuelga, no se puede diferenciar "nunca conectó" de
  // "conectó pero dejó de recibir datos a mitad de una página". Se deja
  // este logger hasta diagnosticar la próxima ocurrencia real.)
  private readonly logger = new Logger(ZteTelnetSession.name);

  constructor(private readonly params: OltConnectionParams) {}

  async connectAndLogin(): Promise<void> {
    const timeoutMs = this.params.timeoutMs || 15000;
    const t0 = Date.now();

    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      this.socket = socket;

      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.logger.warn(`[diag] connectAndLogin TIMEOUT a los ${Date.now() - t0}ms en etapa ${loginStep} contra ${this.params.host}:${this.params.port}`);
          socket.destroy();
          reject(new Error(`Timeout de conexión Telnet (${timeoutMs}ms) contra ${this.params.host}:${this.params.port}`));
        }
      }, timeoutMs);

      socket.connect(this.params.port, this.params.host, () => {
        this.logger.log(`[diag] TCP conectado a los ${Date.now() - t0}ms (${this.params.host}:${this.params.port})`);
      });

      let loginStep: 'WAIT_USER' | 'WAIT_PASS' | 'WAIT_PROMPT' = 'WAIT_USER';

      socket.on('data', (raw: Buffer) => {
        const cleaned = this.handleIac(raw);
        this.buffer += cleaned.toString('ascii');

        // Paginación Telnet ZTE: si aparece --More--, enviar barra espaciadora.
        // No retornar: esta OLT a veces envía el resto (incl. el prompt) en el
        // mismo chunk que el "--More--", así que hay que seguir evaluando.
        if (this.buffer.includes('--More--') || this.buffer.toLowerCase().includes('-- more --')) {
          this.buffer = this.buffer.replace(/--More--/gi, '');
          socket.write(' ');
        }

        if (loginStep === 'WAIT_USER' && /username:\s*$/i.test(this.buffer.trim())) {
          this.buffer = '';
          loginStep = 'WAIT_PASS';
          socket.write(`${this.params.username}\r\n`);
          return;
        }

        if (loginStep === 'WAIT_PASS' && /password:\s*$/i.test(this.buffer.trim())) {
          this.buffer = '';
          loginStep = 'WAIT_PROMPT';
          socket.write(`${this.params.password}\r\n`);
          return;
        }

        if (loginStep === 'WAIT_PROMPT') {
          const lines = this.buffer.split('\n');
          for (const line of lines.reverse()) {
            const stripped = line.trim();
            if (stripped.endsWith('#') && stripped.length > 2 && stripped.length < 35) {
              this.prompt = stripped;
              if (!resolved) {
                resolved = true;
                this.logger.log(`[diag] connectAndLogin OK a los ${Date.now() - t0}ms, prompt="${this.prompt}"`);
                clearTimeout(timer);
                resolve();
              }
              return;
            }
          }
        }
      });

      socket.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      socket.on('close', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(new Error('Conexión cerrada por el host remoto durante el handshake Telnet.'));
        }
      });
    });
  }

  async executeCommand(command: string, timeoutMs = 20000): Promise<string> {
    const socket = this.socket;
    if (!socket) {
      throw new Error('Socket Telnet no inicializado.');
    }

    const t0 = Date.now();
    this.logger.log(`[diag] executeCommand INICIO: "${command}" (timeout ${timeoutMs}ms)`);

    return new Promise<string>((resolve, reject) => {
      let output = '';
      let chunkCount = 0;
      let moreCount = 0;
      this.buffer = '';

      let finished = false;
      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          socket.removeListener('data', onData);
          this.logger.warn(
            `[diag] executeCommand TIMEOUT a los ${Date.now() - t0}ms: "${command}" -- ` +
              `${chunkCount} chunk(s) recibido(s), ${output.length} chars acumulados, ${moreCount} "--More--" visto(s). ` +
              `Últimos 300 chars: ${JSON.stringify(output.slice(-300))}`,
          );
          reject(new Error(`Timeout ejecutando comando OLT: "${command}"`));
        }
      }, timeoutMs);

      const onData = (raw: Buffer) => {
        chunkCount += 1;
        const cleaned = this.handleIac(raw);
        const chunk = cleaned.toString('ascii');
        output += chunk;

        // Confirmación interactiva inesperada (ej. "Confirm to logout
        // without saving? [yes/no]:" al salir de "pon-onu-mng" con "exit" en
        // vez de "end" -- ver generateAuthorizationScript). No hay una
        // respuesta "correcta" genérica (según el comando, "yes" puede
        // significar "confirmar" o "descartar cambios"), así que en vez de
        // adivinar, se falla de inmediato con el texto exacto de la OLT en
        // vez de colgarse hasta agotar el timeout completo.
        if (/\[yes\/no\]:\s*$/i.test(output.trim())) {
          finished = true;
          clearTimeout(timer);
          socket.removeListener('data', onData);
          const prompt = output.trim().slice(-200);
          this.logger.warn(`[diag] executeCommand: confirmación interactiva inesperada en "${command}": "${prompt}"`);
          reject(
            new Error(
              `La OLT pidió una confirmación interactiva que el comando "${command}" no esperaba: "${prompt}". Revisa la secuencia de comandos del driver.`,
            ),
          );
          return;
        }

        if (output.includes('--More--') || output.toLowerCase().includes('-- more --')) {
          moreCount += 1;
          this.logger.log(`[diag] "--More--" #${moreCount} a los ${Date.now() - t0}ms (chunk #${chunkCount}, ${output.length} chars acumulados)`);
          output = output.replace(/--More--/gi, '');
          socket.write(' ');
          // No retornar aquí: esta OLT a veces envía la página final y el
          // prompt de vuelta en el MISMO chunk que el último "--More--" (no
          // espera a que el cliente confirme antes de seguir transmitiendo).
          // Si se retorna sin revisar el prompt, la sesión se queda esperando
          // un chunk que nunca llega -- esto causaba el cuelgue hasta el
          // timeout de 180s en puertos con muchas ONUs/páginas.
        }

        const lines = output.split('\n');
        const lastLine = lines[lines.length - 1]?.trim() || '';

        if (lastLine.endsWith('#') || lastLine.endsWith(')#' )) {
          finished = true;
          clearTimeout(timer);
          socket.removeListener('data', onData);
          this.logger.log(`[diag] executeCommand OK a los ${Date.now() - t0}ms: "${command}" -- ${chunkCount} chunk(s), ${output.length} chars, ${moreCount} "--More--"`);

          // Limpiar eco del comando y prompts
          const cleanLines = lines
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && !l.includes(command) && !l.endsWith('#'));

          resolve(cleanLines.join('\n'));
        }
      };

      socket.on('data', onData);
      socket.write(`${command}\r\n`);
    });
  }

  close(): void {
    if (this.socket) {
      try {
        this.socket.write('exit\r\n');
        this.socket.destroy();
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }

  /**
   * Negociación Telnet IAC (RFC 854)
   * 0xFF 0xFD (DO) -> 0xFF 0xFC (WON'T)
   * 0xFF 0xFB (WILL) -> 0xFF 0xFE (DON'T)
   */
  private handleIac(data: Buffer): Buffer {
    const out: number[] = [];
    let i = 0;
    while (i < data.length) {
      if (data[i] === 0xff && i + 2 < data.length) {
        const cmd = data[i + 1];
        const opt = data[i + 2];
        if (cmd === 0xfd && this.socket) {
          this.socket.write(Buffer.from([0xff, 0xfc, opt]));
        } else if (cmd === 0xfb && this.socket) {
          this.socket.write(Buffer.from([0xff, 0xfe, opt]));
        }
        i += 3;
      } else {
        out.push(data[i]);
        i += 1;
      }
    }
    return Buffer.from(out);
  }
}
