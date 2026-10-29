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
  OnuTypeProfile,
  VlanTranslationParams,
  OltDriverCapabilities,
  DriverNotImplementedError,
  OltAlarm,
  DiscoveredAuthorizedOnu,
  DiscoveredTcontProfile,
  DiscoveredTrafficProfile,
} from '../ports/olt-driver.port';

const VENDOR = 'ZTE';

/**
 * Sentinel reconocido por `authorizeOnu()` dentro del array de comandos que
 * devuelve `generateAuthorizationScript()` -- un reinicio OMCI del ONT exige
 * confirmar un prompt interactivo ("Confirm to reboot? [yes/no]:") que no es
 * un comando CLI plano, así que no puede representarse como una cadena normal
 * en ese array. Ver `ZteTelnetSession.rebootOnu()`.
 */
export const REBOOT_ONU_SENTINEL = '__SUMTECH_REBOOT_ONU__';

@Injectable()
export class ZteC320Driver implements IOltDriver {
  private readonly logger = new Logger(ZteC320Driver.name);

  protected createSession(params: OltConnectionParams): {
    connectAndLogin(): Promise<void>;
    executeCommand(cmd: string, timeoutMs?: number): Promise<string>;
    rebootOnu(timeoutMs?: number): Promise<void>;
    close(): Promise<void>;
  } {
    return new ZteTelnetSession(params);
  }

  /**
   * Detecta si la OLT rechazó un comando -- CONFIRMADO EN VIVO contra
   * OLT_Tabara_Abajo (2026-10-19) que existen DOS formatos de error
   * distintos en este firmware, no uno:
   *   "%Error <código>: <mensaje>"           (ej. interfaz/puerto inexistente)
   *   "%Code <código>-<MÓDULO> : <mensaje>"  (ej. "%Code 63904-GPONRM : Not
   *                                           support this ONU." -- un Tipo
   *                                           de ONU inválido en
   *                                           "onu <id> type <X> sn <Y>";
   *                                           también "%Code 10: Invalid
   *                                           parameter!" por un serial con
   *                                           formato inválido)
   * `authorizeOnu()` nunca revisaba ninguno de los dos antes de este fix:
   * una autorización rechazada por la OLT (ej. por un Tipo de ONU
   * placeholder como "Generico", que no existe como perfil real en la OLT)
   * se reportaba como éxito sin haber escrito nada de verdad.
   */
  private isOltErrorResponse(output: string): boolean {
    return /%Error\b/i.test(output) || /%Code\s+\d+(-\w+)?\s*:/i.test(output);
  }

  /**
   * Detecta el idioma recurrente de este firmware para "este paso del script
   * ya se aplicó en un intento anterior" -- NO es un rechazo real. Confirmado
   * en vivo contra OLT_Tabara_Abajo (2026-10-20) con DOS mensajes distintos,
   * mismo significado:
   *   "%Code 62391-GPONSRV : The entry is existed. This is a re-create
   *   operation." (en "onu <id> type ... sn ...")
   *   "%Code 66661: The service is already existed." (en
   *   "service-port 1 vport 1 user-vlan ... vlan ...")
   *   "%Code 63869-GPONRM : Record already exists." (en "flow <n> switch
   *   switch_0/1" y comandos similares del bloque OMCI -- bug real
   *   confirmado en producción 2026-10-22: reintentar una autorización que ya
   *   había aplicado el cableado OMCI del canal de internet -- ver
   *   `generateAuthorizationScript` -- abortaba en el primer "flow" ya
   *   aplicado en vez de tolerarlo como los demás pasos, porque esta frase
   *   nunca estaba cubierta por el patrón de abajo, pese a ya haberse visto
   *   antes en `applyTr069Management` como advertencia).
   *   "%Code 63873-GPONRM : GEM port already exists." (en "gemport <n> flow <n>"
   *   y "gemport <n> tcont <n>" -- bug real confirmado en producción 2026-10-22:
   *   reintentar la configuración TR-069 o una autorización previa reportaba
   *   una advertencia falsa de fallo de TR-069 ("La OLT rechazó la
   *   configuración TR-069/ACS ('gemport 2 flow 2'): %Code 63873-GPONRM : GEM
   *   port already exists.") o abortaba la autorización).
   * Ambos aparecen cuando una autorización previa de la MISMA ONU falló
   * DESPUÉS de ese paso (ej. por los bugs reales de "gpon-olt_" vs
   * "gpon-onu_" y de "tr069-mgmt" ya corregidos), dejando ese paso concreto
   * ya aplicado en la OLT con el mismo valor que se está volviendo a enviar.
   * Tratar esto como fatal abortaba el resto del script (los pasos
   * siguientes nunca llegaban a aplicarse) aunque ese paso puntual ya
   * estuviera correctamente configurado. Se reconoce en CUALQUIER comando
   * del script de autorización -- `isOltErrorResponse()` sigue tratando
   * cualquier otro texto de error como rechazo real.
   */
  private isAlreadyAppliedResponse(output: string): boolean {
    return /\bis\s+(?:already\s+)?existed\b/i.test(output) || /\balready\s+exist(?:s|ed)?\b/i.test(output);
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
        await session.close();
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
      await session.close();
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
      await session.close();
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
      await session.close();
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
            if (this.isOltErrorResponse(ifaceOut) || !ifaceOut.includes(ifaceName)) {
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
      await session.close();
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
      await session.close();
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

      if (this.isOltErrorResponse(output)) {
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
      await session.close();
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
      await session.close();
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
      if (this.isOltErrorResponse(baseInfoOutput)) {
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
      await session.close();
    }
  }

  /**
   * Parsea name y description de la salida de "show running-config interface gpon-onu_X/Y/Z:ID".
   */
  parseOnuRunningConfig(output: string): { name?: string; description?: string } {
    if (!output || typeof output !== 'string') return {};
    const nameMatch = output.match(/^\s*name\s+(\S+)/mi);
    const descMatch = output.match(/^\s*description\s+(\S+)/mi);
    return {
      name: nameMatch ? nameMatch[1] : undefined,
      description: descMatch ? descMatch[1] : undefined,
    };
  }

  /**
   * Consulta la configuración activa de una sub-interfaz de ONU (ej. gpon-onu_1/2/15:1)
   * para extraer name (cliente) y description (zona/fecha) directamente de la OLT.
   */
  async getOnuRunningConfig(
    params: OltConnectionParams,
    onuInterface: string,
  ): Promise<{ name?: string; description?: string; raw?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const output = await session.executeCommand(`show running-config interface ${onuInterface}`, 15000);
      const parsed = this.parseOnuRunningConfig(output);
      return { ...parsed, raw: output };
    } finally {
      await session.close();
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

      // Parser para ZTE C320 -- CORREGIDO 2026-10-23 tras comparar contra la
      // salida real del equipo de laboratorio (el formato documentado/asumido
      // antes no coincidía y dejaba rxDbm/txDbm/attenuationDb SIEMPRE
      // undefined, para CUALQUIER ONU, no solo una puntual):
      //   OLT                  ONU              Attenuation
      //   up      Rx :-13.404(dbm)      Tx:1.376(dbm)        14.780(dB)
      //   down    Tx :6.719(dbm)        Rx:-21.250(dbm)      27.969(dB)
      // Dos diferencias clave frente al parser anterior:
      // 1) El orden de "Rx"/"Tx" DENTRO de la línea cambia según la fila
      //    ("up" trae Rx primero, "down" trae Tx primero) -- el regex viejo
      //    asumía "Rx" siempre inmediatamente después de "down"/"up".
      // 2) No existe la palabra literal "attenuation:" -- es un número suelto
      //    en "(dB)" al final de cada línea, una atenuación POR DIRECCIÓN.
      // Por eso ahora se busca Rx/Tx dentro de cada línea sin asumir orden, y
      // se toma el "(dB)" final de esa misma línea como su atenuación.
      const lines = output.split(/\r?\n/);
      const downLine = lines.find((l) => /^\s*down\b/i.test(l));
      const upLine = lines.find((l) => /^\s*up\b/i.test(l));

      const parseDirLine = (line?: string) => {
        if (!line) return { rx: undefined, tx: undefined, attenuation: undefined };
        const rxMatch = line.match(/Rx\s*:\s*([-\d.]+)\s*\(dbm\)/i);
        const txMatch = line.match(/Tx\s*:\s*([-\d.]+)\s*\(dbm\)/i);
        const attMatch = line.match(/([-\d.]+)\s*\(dB\)\s*$/i);
        return {
          rx: rxMatch ? parseFloat(rxMatch[1]) : undefined,
          tx: txMatch ? parseFloat(txMatch[1]) : undefined,
          attenuation: attMatch ? parseFloat(attMatch[1]) : undefined,
        };
      };

      // "down Rx" = potencia que la ONU RECIBE de la OLT (Potencia RX (ONU)).
      // "up Tx"   = potencia que la ONU EMITE con su propio láser.
      // La atenuación real OLT->ONU es la de la fila "down" (Tx del OLT vs
      // Rx de la ONU); la de "up" es la del tramo inverso.
      const down = parseDirLine(downLine);
      const up = parseDirLine(upLine);

      return {
        rxDbm: down.rx,
        txDbm: up.tx,
        downRxDbm: down.rx,
        upRxDbm: up.rx,
        attenuationDb: down.attenuation,
        raw: output.slice(0, 300),
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Deriva el nombre de la sub-interfaz lógica de la ONU (ej.
   * "gpon-onu_1/2/15:1") a partir del puerto físico PON (ej.
   * "gpon-olt_1/2/15") -- CONFIRMADO CONTRA EL MANUAL OFICIAL (ZXA10 C300
   * Configuration Manual (CLI), §3.1: "interface gpon-olt_1/5/1" / "onu 2
   * type ... sn ..." / "exit" / "interface gpon-onu_1/5/1:2") que son DOS
   * prefijos distintos ("olt" para el puerto físico, "onu" para la
   * sub-interfaz de cada ONU autorizada en ese puerto), no el mismo nombre
   * con ":<id>" pegado. Bug real confirmado en vivo contra OLT_Tabara_Abajo
   * (2026-10-20): "interface gpon-olt_1/2/15:1" rechazado con "%Error
   * 20202: Invalid input detected ... Invalid parameter".
   */
  private toOnuInterfaceName(ponInterface: string, onuId: number): string {
    return `${ponInterface.replace(/^gpon-olt_/, 'gpon-onu_')}:${onuId}`;
  }

  /**
   * Genera la lista de comandos Telnet de autorización y aprovisionamiento (RF-OLT-016 / RF-ONU-001..007)
   * respetando el orden jerárquico estricto de entidades OMCI (Bottom-Up).
   */
  generateAuthorizationScript(config: import('../ports/olt-driver.port').AuthorizeOnuParams): string[] {
    const hasTr069 = config.managementMethod === 'TR069' && Boolean(config.tr069Url);
    const onuInterface = this.toOnuInterfaceName(config.ponInterface, config.onuId);

    const commands: string[] = [
      // === FASE 1: Registro Físico en Puerto PON ===
      'configure terminal',
      `interface ${config.ponInterface}`,
      `no onu ${config.onuId}`,
      `onu ${config.onuId} type ${config.modelTypeName} sn ${config.serialNumber}`,
      'exit',

      // === FASE 2: Capa de Transporte GPON (T-CONT -> GEM -> Service-Port) ===
      `interface ${onuInterface}`,
      `name ${config.clientName ? config.clientName.replace(/\s+/g, '_') : `ONU-${config.onuId}`}`,
      ...(config.description ? [`description ${config.description.replace(/\s+/g, '_')}`] : []),
      `tcont 1 profile ${config.tcontProfile || 'SMARTOLT-100M-UP'}`,
    ];

    if (hasTr069) {
      commands.push('tcont 2 profile SMARTOLT-VOIPMNG-10M');
    }

    commands.push(
      'gemport 1 tcont 1',
      'gemport 1 traffic-limit downstream SMARTOLT-1G-DOWN',
    );

    if (hasTr069) {
      commands.push(
        'gemport 2 tcont 2',
        'gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M',
      );
    }

    if (config.trafficProfile) {
      commands.push(`traffic-profile ${config.trafficProfile} vport 1 direction egress`);
    }

    commands.push(`service-port 1 vport 1 user-vlan ${config.serviceVlan} vlan ${config.serviceVlan}`);
    if (hasTr069) {
      commands.push(`service-port 2 vport 2 user-vlan ${config.tr069Vlan} vlan ${config.tr069Vlan}`);
    }

    commands.push(
      'exit',

      // === FASE 3: Inicialización de Flows y Mapeo GEM (pon-onu-mng) ===
      // Orden estricto ZTE GPONRM:
      // 1° Instanciar flow en el switch: flow <id> switch switch_0/1 (sin esto, OLT rechaza con %Code 63953 "Flow does not exist")
      // 2° flow mode <id> tag-filter vlan-filter untag-filter discard
      // 3° flow <id> pri <prio> vlan <vlan>
      // 4° gemport <id> flow <id>
      `pon-onu-mng ${onuInterface}`,
      'flow 1 switch switch_0/1',
      'flow mode 1 tag-filter vlan-filter untag-filter discard',
      `flow 1 pri 0 vlan ${config.serviceVlan}`,
      'gemport 1 flow 1',
    );

    if (hasTr069) {
      commands.push(
        'flow 2 switch switch_0/1',
        'flow mode 2 tag-filter vlan-filter untag-filter discard',
        `flow 2 pri 2 vlan ${config.tr069Vlan}`,
        'gemport 2 flow 2',
      );
    }

    // === FASE 4: Vinculación del Switch Virtual (switchport-bind) ===
    // Debe ejecutarse después de los flows y ANTES de configurar ip-host o veip
    commands.push('switchport-bind switch_0/1 iphost 1');
    if (hasTr069) {
      commands.push(
        'switchport-bind switch_0/1 iphost 2',
        'switchport-bind switch_0/1 veip 1',
      );
    }

    // === FASE 5: Configuración de IP-Host y Filtros de VLAN ===
    // Orden estricto: 1° activar ip-host -> 2° vlan-filter-mode -> 3° vlan-filter
    commands.push(
      'ip-host 1 dhcp-enable enable ping-response enable traceroute-response enable',
      'vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard',
      `vlan-filter iphost 1 pri 0 vlan ${config.serviceVlan}`,
    );

    if (hasTr069) {
      commands.push(
        'ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable',
        'vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard',
        `vlan-filter iphost 2 pri 2 vlan ${config.tr069Vlan}`,
      );
    }

    // === FASE 6: Capa de Aplicación (Puertos ETH, VoIP, VEIP, TR-069 y Seguridad) ===
    // "dhcp-ip ethuni ... from-onu" solo si el modelo lo soporta por OMCI --
    // algunos modelos (ej. HUAWEY-BT546XG) lo rechazan con "%Code 63993 :
    // unknown ME", lo que deja el resto de la transacción OMCI en "fail".
    if (config.ethuniDhcpDelegationSupported !== false) {
      commands.push(
        ...Array.from({ length: config.ethPorts ?? 4 }, (_, i) => `dhcp-ip ethuni eth_0/${i + 1} from-onu`),
      );
    }

    if (hasTr069) {
      commands.push(
        'voip protocol sip',
        'veip 1 port udp 1232 host 2',
        'tr069-mgmt 1 state unlock',
        config.tr069AcsUsername && config.tr069AcsPassword
          ? `tr069-mgmt 1 acs ${config.tr069Url} validate basic username ${config.tr069AcsUsername} password ${config.tr069AcsPassword}`
          : `tr069-mgmt 1 acs ${config.tr069Url}`,
        `tr069-mgmt 1 tag pri 2 vlan ${config.tr069Vlan || config.serviceVlan}`,
      );
      // "security-mgmt ..." solo si el modelo lo soporta por OMCI -- algunos
      // modelos (ej. HUAWEY-BT546XG) lo rechazan con "%Code 63993 : unknown
      // ME", lo que deja el resto de la transacción OMCI en "fail". No es
      // necesario para que el ONT se registre en el ACS (eso ya quedó
      // cableado arriba vía iphost 2/VEIP) -- solo habilita acceso remoto
      // HTTPS/SSH/Telnet/FTP/SNMP al propio router desde la OLT.
      if (config.securityMgmtSupported !== false) {
        commands.push(
          'security-mgmt 5 state enable mode forward protocol web https',
          'security-mgmt 998 state enable mode forward ingress-type lan protocol web https',
          'security-mgmt 999 state enable ingress-type lan protocol ftp telnet ssh snmp tr069',
        );
      }
    }

    // Cierre ordenado de sub-vistas (pon-onu-mng -> configure terminal -> EXEC) y persistencia
    commands.push('exit', 'exit', 'write');
    return commands;
  }

  /**
   * Script CLI del bloque OMCI que apunta la ONU al ACS (TR-069) -- Etapa 2 (Reintento aislado).
   * Mantiene el mismo orden jerárquico Bottom-Up para no corromper las entidades ME.
   */
  generateTr069ManagementScript(config: import('../ports/olt-driver.port').AuthorizeOnuParams): string[] {
    if (!config.tr069Url) {
      throw new Error(
        'No se puede generar el bloque TR-069/ACS: falta la URL del ACS (tr069Url). Revisa que la Red TR-069 seleccionada tenga "acsUrl" configurado.',
      );
    }

    const onuInterface = this.toOnuInterfaceName(config.ponInterface, config.onuId);
    const commands: string[] = [
      'configure terminal',
      `pon-onu-mng ${onuInterface}`,
      // 1. Inicializar Flow 2 en orden jerárquico ZTE GPONRM
      'flow 2 switch switch_0/1',
      'flow mode 2 tag-filter vlan-filter untag-filter discard',
      `flow 2 pri 2 vlan ${config.tr069Vlan}`,
      'gemport 2 flow 2',
      // 2. Vincular puertos al switch_0/1 antes de filtrarlos
      'switchport-bind switch_0/1 iphost 2',
      'switchport-bind switch_0/1 veip 1',
      // 3. Configurar IP-Host 2 y su filtro de VLAN en orden
      'ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable',
      'vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard',
      `vlan-filter iphost 2 pri 2 vlan ${config.tr069Vlan}`,
      // 4. Puertos LAN, VoIP, VEIP, TR-069 y Firewall al final
      // "dhcp-ip ethuni ... from-onu" solo si el modelo lo soporta por OMCI --
      // algunos modelos (ej. HUAWEY-BT546XG) lo rechazan con "%Code 63993 :
      // unknown ME", lo que deja el resto de la transacción OMCI en "fail".
      ...(config.ethuniDhcpDelegationSupported !== false
        ? Array.from({ length: config.ethPorts ?? 4 }, (_, i) => `dhcp-ip ethuni eth_0/${i + 1} from-onu`)
        : []),
      'voip protocol sip',
      'veip 1 port udp 1232 host 2',
      'tr069-mgmt 1 state unlock',
      config.tr069AcsUsername && config.tr069AcsPassword
        ? `tr069-mgmt 1 acs ${config.tr069Url} validate basic username ${config.tr069AcsUsername} password ${config.tr069AcsPassword}`
        : `tr069-mgmt 1 acs ${config.tr069Url}`,
      `tr069-mgmt 1 tag pri 2 vlan ${config.tr069Vlan || config.serviceVlan}`,
      // "security-mgmt ..." solo si el modelo lo soporta por OMCI -- algunos
      // modelos (ej. HUAWEY-BT546XG) lo rechazan con "%Code 63993 : unknown
      // ME". No es necesario para el registro TR-069 (ya cableado arriba vía
      // iphost 2/VEIP), solo habilita acceso remoto HTTPS/SSH/Telnet/FTP/SNMP.
      ...(config.securityMgmtSupported !== false
        ? [
            'security-mgmt 5 state enable mode forward protocol web https',
            'security-mgmt 998 state enable mode forward ingress-type lan protocol web https',
            'security-mgmt 999 state enable ingress-type lan protocol ftp telnet ssh snmp tr069',
          ]
        : []),
      // 5. Reinicio OMCI ÚNICAMENTE cuando ya se enviaron tag y security-mgmt
      REBOOT_ONU_SENTINEL,
      'end',
      'write',
    ];

    return commands;
  }

  /**
   * Determina si un comando pertenece al canal de gestión secundario (TR-069, VoIP, VEIP, Firewall)
   * que debe tratarse como mejor esfuerzo (no crítico) para no abortar la provisión de Internet.
   */
  private isManagementOrTr069Command(cmd: string): boolean {
    return (
      cmd.startsWith('tcont 2') ||
      cmd.startsWith('gemport 2') ||
      cmd.startsWith('service-port 2') ||
      cmd.startsWith('flow 2') ||
      cmd.startsWith('flow mode 2') ||
      cmd.startsWith('switchport-bind switch_0/1 iphost 2') ||
      cmd.startsWith('switchport-bind switch_0/1 veip') ||
      cmd.startsWith('ip-host 2') ||
      cmd.startsWith('vlan-filter-mode iphost 2') ||
      cmd.startsWith('vlan-filter iphost 2') ||
      cmd.startsWith('voip') ||
      cmd.startsWith('veip') ||
      cmd.startsWith('tr069-mgmt') ||
      cmd.startsWith('security-mgmt')
    );
  }

  /**
   * Pausa de simulación humana (Human Pacing) adaptada al tiempo de convergencia
   * del hardware óptico, buffers del procesador de control y demonios OMCI de ZTE.
   */
  private getHumanPacingDelay(cmd: string): number {
    if (cmd.startsWith('onu ') && cmd.includes('type ') && cmd.includes('sn ')) {
      return 1500; // Registro de transceptor óptico y espera de .[Successful]
    }
    if (cmd.startsWith('pon-onu-mng ')) {
      return 1500; // Negociación y apertura de sesión de switch virtual OMCI
    }
    if (cmd === 'configure terminal') {
      return 350; // Asentamiento tras banner informativo %Info 20272
    }
    if (cmd === 'write') {
      return 1200; // Escritura en memoria no volátil
    }
    if (cmd === 'exit' || cmd === 'end') {
      return 250; // Cambio de contexto de sub-modo
    }
    return 120; // Pausa humana estándar entre comandos CLI
  }


  /**
   * Ejecuta el aprovisionamiento de la ONU en la OLT respetando los tiempos de
   * convergencia OMCI, simulación de operador humano y el orden jerárquico estricto.
   */
  async authorizeOnu(
    params: OltConnectionParams,
    config: import('../ports/olt-driver.port').AuthorizeOnuParams,
  ): Promise<{
    ok: boolean;
    error?: string;
    warning?: string;
    verification?: import('../ports/olt-driver.port').OnuProvisioningVerification;
  }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();

      await this.ensureOnuTypeProfileWithSession(session, {
        name: config.modelTypeName,
        ethPorts: config.ethPorts,
        potsPorts: config.potsPorts,
      });

      if (config.upKbps) {
        const effectiveTcontProfile = config.tcontProfile || 'SMARTOLT-100M-UP';
        await this.ensureTcontProfileWithSession(session, { name: effectiveTcontProfile, fixedKbps: config.upKbps });
      }

      if (config.trafficProfile && config.downKbps) {
        await this.ensureTrafficProfileWithSession(session, { name: config.trafficProfile, downKbps: config.downKbps });
      }

      const commands = this.generateAuthorizationScript(config);

      let warning: string | undefined;

      for (const cmd of commands) {
        if (cmd.startsWith('no onu ')) {
          await session.executeCommand(cmd);
          await this.delay(200);
          continue;
        }

        let output = await session.executeCommand(cmd);

        // Simulación humana: si hubo un choque de buffer de entrada (%Error 20200), reintentar una vez
        if (output.includes('%Error 20200')) {
          this.logger.warn(`[human-sim] Reintentando comando "${cmd}" tras detectar glitch de input %Error 20200`);
          await this.delay(350);
          output = await session.executeCommand(cmd);
        }

        // Pacing humano entre comandos
        const pacingMs = this.getHumanPacingDelay(cmd);
        if (pacingMs > 0) {
          await this.delay(pacingMs);
        }

        if (this.isOltErrorResponse(output) && !this.isAlreadyAppliedResponse(output)) {
          const errMsg = output.trim();
          this.logger.warn(`[diag] authorizeOnu: OLT reportó respuesta no exitosa en comando "${cmd}": ${errMsg}`);

          if (this.isManagementOrTr069Command(cmd)) {
            // Canal secundario de gestión / TR-069: MEJOR ESFUERZO, nunca abortar la provisión de internet
            if (!warning) {
              warning = `La OLT rechazó la configuración secundaria de gestión ("${cmd}"): ${errMsg}. El canal de internet sí quedó activo.`;
            } else {
              this.logger.warn(`[diag] authorizeOnu: detalle adicional de rechazo en comando de gestión: "${cmd}" -> ${errMsg}`);
            }
          } else {
            // Canal primario de Internet (Fase 1/2/3 datos): error fatal
            throw new Error(`La OLT rechazó el comando "${cmd}": ${errMsg}`);
          }
        }
      }

      // Verificación opcional post-aprovisionamiento
      let verification: import('../ports/olt-driver.port').OnuProvisioningVerification | undefined;
      if (config.verifyPostProvisioning) {
        await this.delay(3000);
        verification = await this.verifyOnuProvisioningWithSession(session, config.ponInterface, config.onuId, {
          expectedVlans: [config.serviceVlan, ...(config.tr069Vlan ? [config.tr069Vlan] : [])],
        });
        if (verification.warnings.length > 0) {
          warning = warning ? `${warning}. ${verification.warnings.join(' ')}` : verification.warnings.join(' ');
        }
      }

      return { ok: true, warning, verification };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  /**
   * Verificación post-aprovisionamiento en la OLT:
   * 1. show gpon remote-onu ip-host gpon-onu_{port}:{onu_id} (valida IP en Host ID: 2)
   * 2. show mac gpon onu gpon-onu_{port}:{onu_id} (valida aprendizaje de MACs en VLANs)
   */
  async verifyOnuProvisioning(
    params: OltConnectionParams,
    ponInterface: string,
    onuId: number,
    options?: { expectedVlans?: number[]; timeoutMs?: number },
  ): Promise<import('../ports/olt-driver.port').OnuProvisioningVerification> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await this.verifyOnuProvisioningWithSession(session, ponInterface, onuId, options);
    } finally {
      await session.close();
    }
  }

  private async verifyOnuProvisioningWithSession(
    session: ReturnType<ZteC320Driver['createSession']>,
    ponInterface: string,
    onuId: number,
    options?: { expectedVlans?: number[] },
  ): Promise<import('../ports/olt-driver.port').OnuProvisioningVerification> {
    const onuInterface = this.toOnuInterfaceName(ponInterface, onuId);
    const warnings: string[] = [];

    // 1. show gpon remote-onu ip-host gpon-onu_{port}:{onu_id}
    const rawIpHost = await session.executeCommand(`show gpon remote-onu ip-host ${onuInterface}`);
    let mgmtIp: string | undefined;
    let ipHostFound = false;

    // Buscar Host ID: 2 (gestión TR-069)
    const host2Match = rawIpHost.match(/Host\s*(?:ID)?\s*:\s*2\b([\s\S]*?)(?:Host\s*(?:ID)?\s*:\s*\d+|$)/i);
    const searchTarget = host2Match ? host2Match[1] : rawIpHost;

    if (host2Match) {
      ipHostFound = true;
    }

    const ipMatch = searchTarget.match(/(?:IP(?:\s+address)?|Current\s*IP)\s*:\s*(\d{1,3}(?:\.\d{1,3}){3})/i);
    if (ipMatch) {
      const parsedIp = ipMatch[1];
      if (parsedIp !== '0.0.0.0') {
        mgmtIp = parsedIp;
      }
    }

    if (!mgmtIp) {
      warnings.push('Host ID: 2 no ha obtenido dirección IP (0.0.0.0 o sin asignar).');
    }

    // 2. show mac gpon onu gpon-onu_{port}:{onu_id}
    const rawMac = await session.executeCommand(`show mac gpon onu ${onuInterface}`);
    const learnedMacs: Array<{ mac: string; vlan: number }> = [];

    const macRegex = /([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}|[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})\s+(?:\S+\s+)?(\d+)/gi;
    let match: RegExpExecArray | null;
    while ((match = macRegex.exec(rawMac)) !== null) {
      learnedMacs.push({
        mac: match[1],
        vlan: parseInt(match[2], 10),
      });
    }

    if (options?.expectedVlans && options.expectedVlans.length > 0) {
      for (const expectedVlan of options.expectedVlans) {
        const found = learnedMacs.some((lm) => lm.vlan === expectedVlan);
        if (!found) {
          warnings.push(`No se han aprendido direcciones MAC en la VLAN configurada ${expectedVlan}.`);
        }
      }
    }

    return {
      ok: warnings.length === 0,
      mgmtIp,
      ipHostFound,
      learnedMacs,
      warnings,
      rawIpHost,
      rawMac,
    };
  }

  /**
   * Aplica SOLO el bloque OMCI que apunta la ONU al ACS (TR-069) -- Etapa 2
   * del flujo de 3 etapas, separada de `authorizeOnu()` para poder
   * reintentarse sin re-autorizar la ONU ópticamente. Asume que la ONU ya
   * está autorizada en la OLT (vport1/service-port1 ya existen).
   *
   * Trata el bloque completo como MEJOR ESFUERZO, no crítico -- mismo
   * criterio que `cpeConfigWarning` del lado del servicio. Confirmado en
   * vivo contra OLT_Tabara_Abajo (2026-10-20) que la OLT puede aceptar el
   * comando pero el ONT lo rechace a nivel OMCI ("%Code 63990-GPONRM : ONT
   * return error: command processing error."). CAUSA RAÍZ CONFIRMADA
   * (2026-10-22): el onu-type del ONT tenía "Max VEIP: 0" -- `veip 1 port
   * udp 1232 host 2` exige que el onu-type soporte al menos 1 VEIP.
   * `ensureOnuTypeProfileWithSession` ya incluye "max-veip 1" para
   * onu-types NUEVOS (ver esa nota), pero esto solo arregla casos futuros:
   * un onu-type que ya existía en la OLT (ej. HUAWEY-HG8145V5 en
   * OLT_Tabara_Abajo) sigue con "Max VEIP: 0" hasta corregirse a mano. Por
   * eso este bloque se mantiene como mejor esfuerzo -- un rechazo acá nunca
   * debe impedir que el admin vea el resultado -- se reporta como
   * `warning`, no como `error` duro, igual que antes hacía `authorizeOnu()`
   * con este mismo bloque.
   */
  async applyTr069Management(
    params: OltConnectionParams,
    config: import('../ports/olt-driver.port').AuthorizeOnuParams,
  ): Promise<{ ok: boolean; error?: string; warning?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();

      const commands = this.generateTr069ManagementScript(config);
      // Acumula TODOS los rechazos de la corrida, no solo el primero -- antes
      // `warning` se fijaba una sola vez (`if (!warning)`) y cualquier
      // rechazo posterior en la MISMA corrida quedaba invisible (ni
      // siquiera en los logs del servidor, porque el `logger.warn` también
      // estaba adentro de ese guard). Eso obligaba a descubrir las
      // incompatibilidades OMCI de un modelo de a una por reintento en vez
      // de verlas todas de una vez (confirmado en vivo, 2026-10-28, ONU
      // ECOM0F91DF9B/HUAWEY-BT546XG: "dhcp-ip ethuni" y "security-mgmt"
      // fueron rechazados en la misma corrida, pero solo el primero se
      // reportó).
      const warnings: string[] = [];
      // TODO el script generado por generateTr069ManagementScript() es el
      // bloque TR-069 (así lo documenta este método) -- antes el flag solo se
      // activaba al llegar a "pon-onu-mng", así que un rechazo en los
      // comandos previos (tcont 2/gemport 2/service-port 2, el segundo
      // camino de datos GPON) era tratado como fatal y abortaba toda la
      // Etapa 2 sin reportar un warning reintentable (bug real confirmado
      // por revisión de código, 2026-10-23).
      const inTr069Block = true;
      // Se pone en `true` dentro de `applyAcsUrlWithRetries()` -- evita que
      // el REBOOT_ONU_SENTINEL de más abajo dispare un reinicio EXTRA e
      // innecesario cuando el reintento del ACS ya reinició el ONT una o
      // varias veces por su cuenta (ver esa nota).
      let acsRebootHandled = false;

      for (const cmd of commands) {
        if (cmd === REBOOT_ONU_SENTINEL) {
          if (acsRebootHandled) {
            continue;
          }
          // No es un comando CLI -- ver REBOOT_ONU_SENTINEL. Mismo criterio
          // de mejor esfuerzo que el resto del bloque TR-069: si el ONT no
          // confirma el reinicio a tiempo, no debe tumbar el resultado
          // completo (la OLT ya aceptó la configuración).
          try {
            await session.rebootOnu();
          } catch (err: any) {
            const msg = `No se pudo confirmar el reinicio OMCI del ONT tras configurar TR-069: ${err.message}. La configuración sí se aplicó en la OLT.`;
            warnings.push(msg);
            this.logger.warn(`[diag] applyTr069Management: rebootOnu() best-effort falló, continuando: ${msg}`);
          }
          continue;
        }

        // Confirmado en vivo (2026-10-23): el rechazo real de este comando
        // ("%Code 63990-GPONRM") no es un problema de sintaxis -- es que el
        // ONT necesita, en algunos casos, varios ciclos de reinicio OMCI
        // antes de aceptar el puntero del ACS, incluso con la secuencia de
        // comandos ya confirmada idéntica a la de un proveedor externo
        // (SmartOLT) que sí funciona. Antes este comando se trataba como un
        // intento único (mejor esfuerzo); ahora se reintenta con reinicio
        // varias veces dentro de la MISMA llamada, en vez de depender de que
        // un job externo (GenieAcsReconciliationService) lo reintente solo
        // cada 10-30 minutos -- confirmado que eso tardó casi una hora sin
        // éxito en producción (2026-10-23) hasta una intervención manual.
        const isAcsCommand = cmd.startsWith('tr069-mgmt') && cmd.includes(' acs ');
        if (isAcsCommand) {
          const acsResult = await this.applyAcsUrlWithRetries(session, cmd);
          acsRebootHandled = true;
          if (acsResult.warningMessage) {
            warnings.push(acsResult.warningMessage);
          }
          continue;
        }

        const output = await session.executeCommand(cmd);

        // Pacing humano entre comandos
        const pacingMs = this.getHumanPacingDelay(cmd);
        if (pacingMs > 0) {
          await this.delay(pacingMs);
        }

        if (this.isOltErrorResponse(output)) {
          if (this.isAlreadyAppliedResponse(output)) {
            // ok, ya aplicado en un intento anterior -- seguir con el resto.
          } else if (inTr069Block) {
            const msg =
              `La OLT rechazó la configuración TR-069/ACS ("${cmd}"): ${output.trim()}. ` +
              'Probablemente debas configurar el WAN manualmente en la ONU.';
            warnings.push(msg);
            this.logger.warn(`[diag] applyTr069Management: TR-069/ACS best-effort falló, continuando: ${msg}`);
            // No se relanza: el resto del script (incluido "end" para salir
            // limpio de "(gpon-onu-mng)#" y el "write" final) debe seguir
            // corriendo igual.
          } else {
            throw new Error(`La OLT rechazó el comando "${cmd}": ${output.trim()}`);
          }
        }
      }

      // Verificación real post-aplicación -- CONFIRMADO EN VIVO (2026-10-23)
      // comparando contra running-config reales de SmartOLT: una ONU puede
      // terminar con "tr069-mgmt"/"veip 1 ... host 2" apuntando a un
      // "iphost 2" que en realidad NUNCA se llegó a crear (faltaba TODO el
      // bloque "flow 2"/"gemport 2 flow 2"/"switchport-bind ... iphost 2"/
      // "ip-host 2 dhcp-enable"/"vlan-filter ... iphost 2"), sin que la OLT
      // devolviera ningún "%Error"/"%Code" detectable en ese momento -- el
      // "mejor esfuerzo" de este método no detectaba nada raro y devolvía
      // `ok:true` sin ningún `warning`, un éxito completamente falso. "Config
      // state" en `show gpon onu detail-info` es la señal real y ya probada
      // de si el ONT aceptó TODO el bloque OMCI, no solo el comando puntual
      // del ACS -- se revisa acá, después del reinicio final, en vez de
      // confiar en que "ningún comando devolvió error" sea suficiente.
      const onuInterface = this.toOnuInterfaceName(config.ponInterface, config.onuId);
      try {
        const detailOutput = await session.executeCommand(`show gpon onu detail-info ${onuInterface}`);
        const configStateMatch = detailOutput.match(/Config state:\s*(\S+)/i);
        const configState = configStateMatch?.[1];
        if (configState && configState.toLowerCase() !== 'success') {
          const configStateWarning =
            `El "Config state" del ONT quedó en "${configState}" (no "success") tras aplicar el bloque TR-069 -- ` +
            'es posible que el canal de gestión (iphost 2/VEIP) no se haya terminado de aplicar pese a que ' +
            'ningún comando individual fue rechazado. Revisa manualmente o reintenta la Etapa 2.';
          warnings.push(configStateWarning);
          this.logger.warn(`[diag] applyTr069Management: ${configStateWarning}`);
        }
      } catch (err: any) {
        // Mejor esfuerzo -- no poder leer el Config state no debe tumbar un
        // resultado que, por lo demás, no tuvo ningún rechazo real.
        this.logger.warn(`[diag] applyTr069Management: no se pudo verificar "Config state": ${err.message}`);
      }

      return { ok: true, warning: warnings.length > 0 ? warnings.join(' | ') : undefined };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  /**
   * Reintenta "tr069-mgmt 1 acs <url>" con reinicio OMCI entre cada intento
   * -- construido tras confirmar en vivo (2026-10-23) que ni la secuencia de
   * comandos ni el orden son el problema (son idénticos a los de SmartOLT,
   * que sí funciona): lo que distingue un intento exitoso de uno rechazado
   * es, simplemente, cuántas veces se reintentó con reinicio de por medio.
   * `maxAttempts`/`delayMs` son conservadores a propósito -- cada intento
   * rechazado cuesta un reinicio OMCI (~20-30s hasta volver a "working") más
   * el delay; con los valores por defecto (6 intentos, 20s) el peor caso
   * ronda los 2-2.5 minutos dentro de esta misma llamada HTTP. Si el proxy
   * balanceador delante del backend tiene un timeout más corto que eso,
   * hay que bajar `maxAttempts` o mover este reintento a un job asíncrono.
   */
  private async applyAcsUrlWithRetries(
    session: ReturnType<ZteC320Driver['createSession']>,
    acsCmd: string,
    maxAttempts = 6,
    delayMs = 20000,
  ): Promise<{ accepted: boolean; warningMessage?: string }> {
    let lastRejection: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const output = await session.executeCommand(acsCmd);
      const accepted = !this.isOltErrorResponse(output) || this.isAlreadyAppliedResponse(output);

      if (accepted) {
        this.logger.log(`[diag] applyAcsUrlWithRetries: ACS aceptado en el intento ${attempt}/${maxAttempts}.`);
      } else {
        lastRejection = output.trim();
        this.logger.warn(
          `[diag] applyAcsUrlWithRetries: intento ${attempt}/${maxAttempts} rechazado ("${acsCmd}"): ${lastRejection}`,
        );
      }

      // Reinicio obligatorio tras CADA intento -- aceptado o no. Los SET de
      // OMCI de este ONT no son idempotentes y no toman efecto real sin
      // reiniciar (mismo motivo por el que REBOOT_ONU_SENTINEL siempre lo
      // hacía antes de este cambio) -- un intento "aceptado" en la OLT
      // igual necesita este reinicio para que el ONT lo aplique de verdad.
      // Mejor esfuerzo: un timeout confirmando el reinicio no debe tumbar un
      // resultado ya aceptado, pero sí se reporta como warning.
      let rebootWarning: string | undefined;
      try {
        await session.rebootOnu();
      } catch (err: any) {
        rebootWarning = `No se pudo confirmar el reinicio OMCI del ONT: ${err.message}.`;
        this.logger.warn(
          `[diag] applyAcsUrlWithRetries: rebootOnu() best-effort falló en el intento ${attempt}: ${err.message}`,
        );
      }

      if (accepted) {
        return { accepted: true, warningMessage: rebootWarning };
      }

      if (attempt < maxAttempts) {
        await this.delay(delayMs);
      }
    }

    return {
      accepted: false,
      warningMessage:
        `La OLT rechazó la configuración TR-069/ACS ("${acsCmd}") tras ${maxAttempts} intentos con reinicio: ` +
        `${lastRejection}. Probablemente debas configurar el WAN manualmente en la ONU.`,
    };
  }

  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Versión aislada de `applyTr069Management` que SOLO toca el puntero del
   * ACS -- no vuelve a tocar tcont 2/gemport 2/service-port 2/flow 2/
   * vlan-filter iphost 2/veip 1 (eso lo deja intacto; debe haberse aplicado
   * antes vía `applyTr069Management`). Nace porque tratar un rechazo de
   * "tr069-mgmt ... acs ..." como mejor esfuerzo (ver esa nota) hacía que
   * ESTA acción puntual -- "solo quiero cambiar a qué ACS apunta" -- nunca
   * reportara un fallo real, incluso cuando la OLT lo rechazaba de plano.
   */
  async updateTr069AcsUrl(
    params: OltConnectionParams,
    config: {
      ponInterface: string;
      onuId: number;
      tr069Url: string;
      tr069AcsUsername?: string;
      tr069AcsPassword?: string;
    },
  ): Promise<{ ok: boolean; error?: string; warning?: string }> {
    const onuInterface = this.toOnuInterfaceName(config.ponInterface, config.onuId);
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();

      await session.executeCommand('configure terminal');
      const pomOutput = await session.executeCommand(`pon-onu-mng ${onuInterface}`);
      if (this.isOltErrorResponse(pomOutput)) {
        throw new Error(`La OLT rechazó entrar a "pon-onu-mng ${onuInterface}": ${pomOutput.trim()}`);
      }

      // Mismo formato que `generateTr069ManagementScript` -- "acs <url>" y
      // "validate basic username/password" van en un solo comando (eso sí es
      // correcto; lo separado de "tag pri ... vlan ..." es otro comando
      // aparte, que este método no toca).
      const acsCmd =
        config.tr069AcsUsername && config.tr069AcsPassword
          ? `tr069-mgmt 1 acs ${config.tr069Url} validate basic username ${config.tr069AcsUsername} password ${config.tr069AcsPassword}`
          : `tr069-mgmt 1 acs ${config.tr069Url}`;
      const acsOutput = await session.executeCommand(acsCmd);
      if (this.isOltErrorResponse(acsOutput) && !this.isAlreadyAppliedResponse(acsOutput)) {
        // Error DURO a propósito -- ver el comentario de la interfaz
        // (`updateTr069AcsUrl` en olt-driver.port.ts) sobre por qué esta
        // única pieza no se trata como mejor esfuerzo.
        throw new Error(`La OLT rechazó "tr069-mgmt 1 acs": ${acsOutput.trim()}`);
      }

      // El reinicio SÍ sigue siendo mejor esfuerzo: un timeout esperando
      // "[yes/no]:" es un problema de temporización/sesión ya documentado
      // (ver rebootOnu()), no evidencia de que la OLT haya rechazado el ACS.
      let warning: string | undefined;
      try {
        await session.rebootOnu();
      } catch (err: any) {
        warning = `El ACS se configuró en la OLT, pero no se pudo confirmar el reinicio OMCI del ONT: ${err.message}. El cambio puede no tomar efecto hasta reiniciar manualmente.`;
        this.logger.warn(`[diag] updateTr069AcsUrl: rebootOnu() best-effort falló, continuando: ${warning}`);
      }

      await session.executeCommand('end');
      await session.executeCommand('write');

      return { ok: true, warning };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
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
      await session.close();
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
      await session.close();
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
    const createOutput = await session.executeCommand(
      `profile tcont ${profile.name} type 5 fixed 64 assured 64 maximum ${profile.fixedKbps}`,
    );
    if (this.isOltErrorResponse(createOutput)) {
      throw new Error(`La OLT rechazó el perfil TCONT "${profile.name}": ${createOutput.trim()}`);
    }
    await session.executeCommand('exit');
    await session.executeCommand('exit');
    await session.executeCommand('write');
  }

  /**
   * Crea (o comprueba) el traffic-profile de BAJADA (CIR=PIR=downKbps) --
   * CONFIRMADO EN VIVO contra OLT_Tabara_Abajo (2026-10-19/2026-10-27):
   *   "show traffic-profile" lista los perfiles existentes sin entrar a config.
   * Si el perfil ya existe, retorna inmediatamente sin mandar comandos innecesarios
   * a la OLT ni escribir a la flash (write).
   * Si no existe, lo crea con:
   *   configure terminal / traffic-profile <nombre> ip cir <kbps> cbs 1000
   *   pir <kbps> pbs 1000 / exit / write
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
      await session.close();
    }
  }

  private async ensureTrafficProfileWithSession(
    session: { executeCommand(cmd: string, timeoutMs?: number): Promise<string> },
    profile: TrafficProfile,
  ): Promise<void> {
    const listOutput = await session.executeCommand('show traffic-profile');
    const existing = this.parseTrafficProfilesFromOutput(listOutput).find((p) => p.name === profile.name);
    if (existing) {
      return;
    }

    await session.executeCommand('configure terminal');
    const createOutput = await session.executeCommand(
      `traffic-profile ${profile.name} ip cir ${profile.downKbps} cbs 1000 pir ${profile.downKbps} pbs 1000`,
    );
    if (this.isOltErrorResponse(createOutput)) {
      // Salir de "(config)#" antes de lanzar
      try {
        await session.executeCommand('exit');
      } catch {
        /* best-effort */
      }
      throw new Error(`La OLT rechazó el traffic-profile "${profile.name}": ${createOutput.trim()}`);
    }
    await session.executeCommand('exit');
    await session.executeCommand('write');
  }

  parseTrafficProfilesFromOutput(output: string): DiscoveredTrafficProfile[] {
    const regex = /No\.\s*\d+\s+profile\s*:\s*([^\r\n]+)/g;
    const profiles: DiscoveredTrafficProfile[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(output)) !== null) {
      const name = match[1].trim();
      if (!name) continue;
      const mbMatch = name.match(/TRAFFIC-(\d+)M/i);
      const downKbps = mbMatch ? parseInt(mbMatch[1], 10) * 1024 : undefined;
      profiles.push({ name, downKbps });
    }
    return profiles;
  }

  /**
   * Consulta qué perfiles de tráfico (downstream) REALMENTE existen en la OLT
   * mediante "show traffic-profile" (confirmado en vivo contra OLT_Tabara_Abajo).
   */
  async getTrafficProfiles(params: OltConnectionParams): Promise<DiscoveredTrafficProfile[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const output = await session.executeCommand('show traffic-profile');
      return this.parseTrafficProfilesFromOutput(output);
    } finally {
      await session.close();
    }
  }

  /**
   * Asegura que el "onu-type" (perfil de capacidades OMCI que exige
   * `onu <id> type <nombre> sn <serial>`) exista en la OLT antes de
   * autorizar -- sin esto, la OLT rechaza con "%Code 63904-GPONRM : Not
   * support this ONU." cualquier modelo que nunca se haya registrado antes
   * a mano por Telnet. Los límites OMCI (max-tcont 8, max-gemport 32,
   * max-switch-perslot 8, max-flow-perswitch 8) reutilizan los mismos
   * valores genéricos que ya traen los 2 perfiles Huawei reales preexistentes
   * en OLT_Tabara_Abajo (HUAWEY-HG8145V5, HUAWEY-BT546XG) -- no hay forma de
   * descubrir los límites OMCI reales de un modelo sin su datasheet.
   *
   * CONFIRMADO CONTRA EL MANUAL OFICIAL (ZXA10 C300 Configuration Manual
   * (CLI), §2.1, SJ-20130520164529-007): el flujo "configure terminal" /
   * "pon" / "onu-type <nombre> gpon description <desc> max-tcont <n>
   * max-gemport <n> max-switch-perslot <n> max-flow-perswitch <n>" /
   * "onu-type-if <nombre> eth_0/1-<N>" / "onu-type-if <nombre> pots_0/1-<N>"
   * es correcto -- PERO el primer intento en vivo contra OLT_Tabara_Abajo
   * (2026-10-19) falló con "%Error 20201: Invalid input detected ... Invalid
   * command key word" porque `description` se mandaba entre comillas con
   * espacios (`"Auto-creado por Sumtech"`). El manual (ejemplo real:
   * "description 4ETH,2POTS") deja claro que NO es una cadena libre, sino
   * un solo token SIN espacios ni comillas -- por eso ahora se genera como
   * "<ethPorts>ETH,<potsPorts>POTS", replicando la misma convención que usa
   * el propio fabricante en sus tipos nativos (ZTEG-F620, etc.).
   *
   * "max-veip 1" agregado (2026-10-22) -- sin esto el onu-type queda con
   * "Max VEIP: 0" (keyword real, confirmado vía ayuda contextual de la OLT),
   * lo que bloquea a nivel OMCI el bloque TR-069 de
   * `generateTr069ManagementScript` para CUALQUIER ONU que use un onu-type
   * creado por este método. Se aplica tanto a onu-types NUEVOS (en la
   * creación) como a onu-types que YA EXISTÍAN de antes con "Max VEIP: 0"
   * (ej. HUAWEY-HG8145V5 en OLT_Tabara_Abajo) -- ver el chequeo de
   * `alreadyExists` más abajo, que ahora repara ese campo en caliente en vez
   * de salir sin tocar nada.
   */
  async ensureOnuTypeProfile(params: OltConnectionParams, profile: OnuTypeProfile): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await this.ensureOnuTypeProfileWithSession(session, profile);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  private async ensureOnuTypeProfileWithSession(
    session: { executeCommand(cmd: string, timeoutMs?: number): Promise<string> },
    profile: OnuTypeProfile,
  ): Promise<void> {
    const checkOutput = await session.executeCommand(`show onu-type gpon ${profile.name}`);
    const alreadyExists = !this.isOltErrorResponse(checkOutput) && checkOutput.includes(profile.name);
    if (alreadyExists) {
      // CONFIRMADO EN VIVO (2026-10-22) contra OLT_Tabara_Abajo: un onu-type
      // PREEXISTENTE (creado antes de que este método supiera de "max-veip",
      // ej. HUAWEY-HG8145V5) puede quedar con "Max VEIP: 0" -- esto bloquea a
      // nivel OMCI el comando "veip 1 port udp 1232 host 2" del bloque TR-069
      // con "%Code 63990-GPONRM : ONT return error: command processing
      // error.", sin importar cuántas veces se reautorice la ONU, porque
      // antes este método se salía aquí sin tocar un onu-type ya existente.
      // "show onu-type gpon <nombre>" reporta "Max VEIP:   0(default: 1
      // VEIP)" -- se repara en caliente con "onu-type <nombre> gpon max-veip
      // 1". Según la gramática real de este comando (confirmada vía ayuda
      // contextual: todos los parámetros de "onu-type <nombre> gpon ..." son
      // opcionales e independientes entre sí), esto debería actualizar SOLO
      // "max-veip" sin tocar el resto -- AÚN NO reconfirmado en vivo (el
      // sandbox bloqueó el intento de probarlo manualmente), así que sigue
      // sin ser 100% seguro hasta la próxima autorización real.
      //
      // MEJOR ESFUERZO, nunca debe tumbar la autorización -- CONFIRMADO EN
      // VIVO (2026-10-22) que la OLT puede rechazar esta corrección con
      // "%Code 70296 : Profile is being used." cuando el onu-type ya tiene
      // OTRAS ONUs reales asignadas (caso normal: un modelo común como
      // HUAWEY-HG8145V5 suele ser compartido por varias ONUs en la misma
      // OLT) -- un primer intento de este fix lo trataba como error duro y
      // tumbaba la autorización óptica completa, rompiendo algo que antes
      // funcionaba. Si la corrección falla, se registra un warning y se
      // sigue -- el TR-069 de la Etapa 2 seguirá fallando para este
      // onu-type hasta que se libere (ningún ONU usándolo) o se corrija a
      // mano, pero eso nunca debe bloquear que el cliente quede con internet
      // (Etapa 1).
      const maxVeipMatch = checkOutput.match(/Max VEIP:\s*(\d+)/i);
      const maxVeip = maxVeipMatch ? parseInt(maxVeipMatch[1], 10) : undefined;
      if (maxVeip !== undefined && maxVeip < 1) {
        let fixSucceeded = false;
        try {
          await session.executeCommand('configure terminal');
          await session.executeCommand('pon');
          const fixOutput = await session.executeCommand(`onu-type ${profile.name} gpon max-veip 1`);
          if (this.isOltErrorResponse(fixOutput)) {
            this.logger.warn(
              `[diag] ensureOnuTypeProfileWithSession: no se pudo corregir "max-veip" del onu-type "${profile.name}" (mejor esfuerzo, no bloquea la autorización): ${fixOutput.trim()}`,
            );
          } else {
            fixSucceeded = true;
          }
        } catch (err: any) {
          // De verdad "mejor esfuerzo": antes, una excepción acá (timeout,
          // socket cerrado) se propagaba sin ningún catch y abortaba TODA la
          // autorización óptica, contradiciendo este mismo comentario (bug
          // real confirmado por revisión de código, 2026-10-23).
          this.logger.warn(
            `[diag] ensureOnuTypeProfileWithSession: excepción corrigiendo "max-veip" del onu-type "${profile.name}" (mejor esfuerzo, no bloquea la autorización): ${err.message}`,
          );
        } finally {
          // "write" EXIGE estar en el prompt top-level "#" (mismo criterio
          // que el resto de este archivo) -- nunca dentro de "configure
          // terminal"/"pon", por eso corre DESPUÉS de los dos "exit", no antes.
          // Cada "exit" también es best-effort: si el socket ya quedó en mal
          // estado por la excepción de arriba, no debe enmascararla ni
          // lanzar una nueva.
          try {
            await session.executeCommand('exit');
          } catch {
            /* best-effort */
          }
          try {
            await session.executeCommand('exit');
          } catch {
            /* best-effort */
          }
        }
        if (fixSucceeded) {
          try {
            await session.executeCommand('write');
          } catch (err: any) {
            this.logger.warn(
              `[diag] ensureOnuTypeProfileWithSession: no se pudo guardar "write" tras corregir max-veip (mejor esfuerzo): ${err.message}`,
            );
          }
        }
      }
      return;
    }

    await session.executeCommand('configure terminal');
    await session.executeCommand('pon');
    const description = `${profile.ethPorts ?? 0}ETH,${profile.potsPorts ?? 0}POTS`;
    // "max-veip 1" -- CONFIRMADO EN VIVO (2026-10-22) contra OLT_Tabara_Abajo:
    // sin este parámetro, el onu-type queda con "Max VEIP: 0" (confirmado vía
    // "show onu-type gpon <nombre>"), lo que hace que el ONT rechace a nivel
    // OMCI el comando "veip 1 port udp 1232 host 2" del bloque TR-069
    // (generateTr069ManagementScript) con "%Code 63990-GPONRM : ONT return
    // error: command processing error." -- la Etapa 2 del flujo de 3 etapas
    // (applyTr069Profile) nunca llega a apuntar el ONT al ACS para ningún
    // onu-type creado por este método. "max-veip" confirmado como keyword
    // real vía ayuda contextual ("onu-type <nombre> gpon ... ?").
    const createOutput = await session.executeCommand(
      `onu-type ${profile.name} gpon description ${description} max-tcont 8 max-gemport 32 max-switch-perslot 8 max-flow-perswitch 8 max-veip 1`,
    );
    if (this.isOltErrorResponse(createOutput)) {
      await session.executeCommand('exit');
      await session.executeCommand('exit');
      throw new Error(`La OLT rechazó el onu-type "${profile.name}": ${createOutput.trim()}`);
    }

    if (profile.ethPorts && profile.ethPorts > 0) {
      const ethOutput = await session.executeCommand(`onu-type-if ${profile.name} eth_0/1-${profile.ethPorts}`);
      if (this.isOltErrorResponse(ethOutput)) {
        await session.executeCommand('exit');
        await session.executeCommand('exit');
        throw new Error(`La OLT rechazó los puertos ETH del onu-type "${profile.name}": ${ethOutput.trim()}`);
      }
    }
    if (profile.potsPorts && profile.potsPorts > 0) {
      const potsOutput = await session.executeCommand(`onu-type-if ${profile.name} pots_0/1-${profile.potsPorts}`);
      if (this.isOltErrorResponse(potsOutput)) {
        await session.executeCommand('exit');
        await session.executeCommand('exit');
        throw new Error(`La OLT rechazó los puertos POTS del onu-type "${profile.name}": ${potsOutput.trim()}`);
      }
    }

    await session.executeCommand('exit');
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
      await session.close();
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
      await session.close();
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
      await session.close();
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
      await session.close();
    }
  }

  async getRunningConfig(params: OltConnectionParams): Promise<string> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await session.executeCommand('show running-config', 20000);
    } finally {
      await session.close();
    }
  }

  async runRawCommand(params: OltConnectionParams, command: string): Promise<string> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await session.executeCommand(command, 20000);
    } finally {
      await session.close();
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
      await session.close();
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
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19): el camino
      // de autorización (authorizeOnu/generateAuthorizationScript) nunca se
      // había probado contra esta OLT -- se encontraron y corrigieron 2 bugs
      // reales: (1) sin TR069, el script nunca salía de "(config)#" antes de
      // "write", que falla si no está en el prompt top-level "#"; (2) ningún
      // comando revisaba si la OLT respondía con error ("%Error ..." o
      // "%Code <n>-<módulo> : ...", confirmado que existen AMBOS formatos),
      // así que un rechazo real (ej. Tipo de ONU inválido) se reportaba como
      // éxito sin haber autorizado nada. Ver isOltErrorResponse().
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
      // RESUELTO (2026-10-20) contra OLT_Tabara_Abajo / ONU CMDCDD4D131E
      // (Huawei HG8546M): el rechazo "%Code 63990-GPONRM : ONT return error:
      // command processing error." en "tr069-mgmt 1 acs <url>" NO era un
      // límite del firmware del ONT (conclusión errónea de una investigación
      // anterior, ya descartada) -- faltaba un segundo camino de datos GPON
      // (tcont/gemport/service-port) para la VLAN de gestión TR-069 y el
      // cableado OMCI interno que lo conecta al VEIP (flow/switchport-bind/
      // ip-host/vlan-filter/veip). `generateAuthorizationScript()` ya genera
      // ambos (ver `hasTr069Datapath`) + un reinicio OMCI obligatorio al
      // final (los SET de este ONT no son idempotentes; cualquier cambio
      // puede dejar "Config state" en "fail" hasta reiniciar). Historial
      // completo de la investigación y del fix de NAT/WireGuard (fuera del
      // alcance de este driver) en docs/onu-tr069-provisioning-zte-c320.md.
      //
      // Se deja en `false` todavía porque este código no se reconfirmó en
      // vivo contra una ONU recién autorizada por Sumtech (la prueba del
      // 2026-10-20 reutilizó un "onu-type" ya existente en la OLT, creado por
      // SmartOLT) -- en particular, `ensureOnuTypeProfileWithSession()`
      // creaba los "onu-type" nuevos sin ningún parámetro de capacidad VEIP.
      // CONFIRMADO EN VIVO (2026-10-22): esa era justo la causa de que
      // "tr069-mgmt ... acs ..." siguiera siendo rechazado ("Max VEIP: 0" en
      // el onu-type) -- ya se agregó "max-veip 1" a ese método. Falta
      // reconfirmar en vivo contra un onu-type NUEVO (creado por este
      // driver, no uno preexistente) antes de pasar esta capacidad a `true`.
      // Ver OnuTypeProfileProvisioning.
      // CONFIRMADO EN VIVO (2026-10-24): el bloque completo (incluido el
      // canal de gestión y TR-069) ya se genera en una sola sesión atómica.
      tr069AutoProvisioning: true,
      onuPassiveImport: true,
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19): "show vlan
      // port <interfaz>" responde con datos reales tanto en uplink
      // (gei_1/4/1) como en PON (gpon-olt_1/2/1).
      vlanDiscovery: true,
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19): "show gpon
      // profile tcont" responde con ~40 perfiles reales ya configurados.
      tcontDiscovery: true,
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-27): "show traffic-profile"
      // responde con los 15 perfiles de tráfico de bajada existentes.
      trafficDiscovery: true,
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19): se creó y
      // eliminó un traffic-profile de prueba real ("SUMTECH-TEST-DELETE-ME")
      // con el flujo completo configure terminal/traffic-profile/exit/write
      // -- ver ensureTrafficProfile().
      downstreamTrafficProfile: true,
      // Sintaxis ahora confirmada contra el manual oficial (ZXA10 C300
      // Configuration Manual (CLI), §2.1) tras un primer intento en vivo
      // fallido contra OLT_Tabara_Abajo (2026-10-19: "%Error 20201" por
      // mandar "description" entre comillas con espacios, cuando el manual
      // exige un solo token sin espacios, ej. "4ETH,2POTS") -- pero la
      // corrección en sí (description sin comillas) TODAVÍA no se reprobó
      // en vivo, así que se deja en `false` hasta confirmarse, según la
      // convención de este archivo. Ver ensureOnuTypeProfile().
      // Sintaxis confirmada contra el manual oficial y corregida en vivo.
      onuTypeProfileProvisioning: true,
    };
  }

  getCapabilityNotes(): Partial<Record<keyof OltDriverCapabilities, string>> {
    return {
      tr069AutoProvisioning:
        'El driver ya genera el segundo camino de datos GPON para la VLAN de gestión y todo el cableado OMCI (flow/switchport-bind/ip-host/vlan-filter/veip) que conecta con el VEIP, más un reinicio OMCI obligatorio al final -- causa raíz real encontrada y corregida el 2026-10-20 (ver docs/onu-tr069-provisioning-zte-c320.md). Falta reconfirmar en vivo contra una ONU recién autorizada por Sumtech (no una que reutilice un onu-type preexistente) antes de pasar esta capacidad a `true`.',
      onuTypeProfileProvisioning:
        'El driver ya intenta crear el "onu-type" automáticamente al autorizar, con sintaxis confirmada contra el manual oficial (ZXA10 C300 Configuration Manual (CLI), §2.1) después de que un primer intento en vivo fallara por mandar "description" entre comillas con espacios -- la corrección todavía no se reprobó contra la OLT real.',
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
  /**
   * Se pone en `true` al entrar a "configure terminal" -- señal de que la
   * sesión puede tener cambios sin guardar. Usado por `close()` para decidir
   * si vale la pena esperar un posible prompt interactivo "[yes/no]:" al
   * salir (ver close() para el porqué). Las sesiones de solo lectura (show *)
   * nunca lo activan, así que no pagan ningún costo de espera adicional.
   */
  private dirty = false;
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
          socket.removeListener('data', onData);
          socket.destroy();
          reject(new Error(`Timeout de conexión Telnet (${timeoutMs}ms) contra ${this.params.host}:${this.params.port}`));
        }
      }, timeoutMs);

      socket.connect(this.params.port, this.params.host, () => {
        this.logger.log(`[diag] TCP conectado a los ${Date.now() - t0}ms (${this.params.host}:${this.params.port})`);
      });

      let loginStep: 'WAIT_USER' | 'WAIT_PASS' | 'WAIT_PROMPT' = 'WAIT_USER';

      // Este handler DEBE removerse al terminar el login (éxito o fallo): el
      // socket se reutiliza después para executeCommand()/rebootOnu(), que
      // registran sus propios handlers 'data'. Sin remover este, ambos
      // procesan cada chunk -- cada "--More--" recibía DOS espacios (uno de
      // este handler zombie, otro del handler real), avanzando dos páginas
      // de paginación por cada una y perdiendo la intermedia (bug real
      // confirmado por revisión de código, 2026-10-23).
      const cleanup = () => socket.removeListener('data', onData);

      const onData = (raw: Buffer) => {
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
                cleanup();
                resolve();
              }
              return;
            }
          }
        }
      };

      socket.on('data', onData);

      socket.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          cleanup();
          reject(err);
        }
      });

      socket.on('close', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          cleanup();
          reject(new Error('Conexión cerrada por el host remoto durante el handshake Telnet.'));
        }
      });
    });

    // Desactivar paginación CLI ZTE para evitar cuelgues por prompts --More--
    try {
      await this.executeCommand('terminal length 0', 3000);
    } catch (err: any) {
      this.logger.debug?.(`terminal length 0 no soportado o ignorado: ${err.message}`);
    }
  }

  async executeCommand(command: string, timeoutMs = 20000): Promise<string> {
    const socket = this.socket;
    if (!socket) {
      throw new Error('Socket Telnet no inicializado.');
    }

    if (command === 'configure terminal') {
      this.dirty = true;
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

  /**
   * Reinicia el ONT por OMCI -- asume que la sesión YA está posicionada
   * dentro de "pon-onu-mng <iface>" (no entra el submodo por su cuenta). A
   * diferencia de `executeCommand()`, este comando SÍ espera (y responde) la
   * confirmación interactiva "Confirm to reboot? [yes/no]:" -- CONFIRMADO EN
   * VIVO contra OLT_Tabara_Abajo (2026-10-20, ONU CMDCDD4D131E) escribiendo
   * directo al socket en vez de usar `executeCommand()`, que por diseño
   * rechaza cualquier prompt "[yes/no]:" inesperado en vez de adivinar.
   */
  async rebootOnu(timeoutMs = 20000): Promise<void> {
    const socket = this.socket;
    if (!socket) {
      throw new Error('Socket Telnet no inicializado.');
    }

    const t0 = Date.now();
    this.logger.log('[diag] rebootOnu INICIO');

    await new Promise<void>((resolve, reject) => {
      let output = '';
      let confirmed = false;
      let finished = false;

      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          socket.removeListener('data', onData);
          this.logger.warn(`[diag] rebootOnu TIMEOUT a los ${Date.now() - t0}ms. Últimos 300 chars: ${JSON.stringify(output.slice(-300))}`);
          reject(new Error('Timeout esperando confirmación de reinicio OMCI del ONT.'));
        }
      }, timeoutMs);

      const onData = (raw: Buffer) => {
        const cleaned = this.handleIac(raw);
        output += cleaned.toString('ascii');

        if (!confirmed && /\[yes\/no\]:\s*$/i.test(output.trim())) {
          confirmed = true;
          output = '';
          socket.write('yes\r\n');
          return;
        }

        if (confirmed) {
          const lines = output.split('\n');
          const lastLine = lines[lines.length - 1]?.trim() || '';
          if (lastLine.endsWith('#') || lastLine.endsWith(')#')) {
            finished = true;
            clearTimeout(timer);
            socket.removeListener('data', onData);
            this.logger.log(`[diag] rebootOnu OK a los ${Date.now() - t0}ms`);
            resolve();
          }
        }
      };

      socket.on('data', onData);
      socket.write('reboot\r\n');
    });
  }

  /**
   * CONFIRMADO EN VIVO (logs de producción): "exit" dentro de un submodo con
   * cambios sin guardar dispara el prompt interactivo "The configuration is
   * changed,confirm to logout without saving? [yes/no]:" -- antes este
   * método escribía "exit\r\n" y destruía el socket de inmediato, sin
   * esperar esa respuesta. Si la OLT se queda esperando un "yes"/"no" que
   * nunca llega porque el socket ya se cerró, la sesión puede quedar
   * colgada del lado del equipo (contando contra el límite de sesiones
   * Telnet concurrentes) en vez de liberarse de inmediato. Mismo patrón ya
   * probado en `rebootOnu()`: escuchar la respuesta real y solo responder
   * "yes" si el prompt efectivamente aparece -- nunca se manda "yes" a
   * ciegas, porque en cualquier otro contexto eso se interpretaría como un
   * comando literal inválido. Las sesiones de solo lectura (sin
   * "configure terminal") nunca entran a este camino -- destrucción
   * inmediata, sin penalidad de espera.
   */
  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) {
      return;
    }

    if (!this.dirty) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      return;
    }

    const graceMs = 500;
    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        socket.removeListener('data', onData);
        try {
          socket.destroy();
        } catch {
          // ignore
        }
        resolve();
      };

      const timer = setTimeout(finish, graceMs);

      const onData = (raw: Buffer) => {
        const cleaned = this.handleIac(raw);
        const text = cleaned.toString('ascii').trim();
        if (/\[yes\/no\]:\s*$/i.test(text)) {
          try {
            socket.write('yes\r\n');
          } catch {
            // ignore
          }
          // Pequeño margen para que "yes\r\n" viaje antes de destruir.
          clearTimeout(timer);
          setTimeout(finish, 200);
        }
      };

      socket.on('data', onData);
      try {
        socket.write('exit\r\n');
      } catch {
        finish();
      }
    });
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
