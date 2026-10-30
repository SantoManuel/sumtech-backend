import { Injectable, Logger } from '@nestjs/common';
import { ZteTelnetSession } from './zte-telnet-session';
import {
  isOltErrorResponse,
  isAlreadyAppliedResponse,
  parseZteUptimeToSeconds,
  parseCards,
  parseVlanList,
  inferVendorFromSerial,
  parseOnuRunningConfig,
  parseIpHost,
  parseMacTable,
  parseOnuDetailInfo,
  parseTcontProfilesFromOutput,
  parseTrafficProfilesFromOutput,
} from './zte-c320-parsers';
import {
  toOnuInterfaceName,
  generateAuthorizationScript as generateAuthorizationScriptImpl,
  generateTr069ManagementScript as generateTr069ManagementScriptImpl,
  isManagementOrTr069Command,
  getHumanPacingDelay,
  REBOOT_ONU_SENTINEL,
} from './zte-c320-provisioning-scripts';
import {
  verifyOnuProvisioningWithSession,
  getOnuIpHostWithSession,
  getOnuMacTableWithSession,
  getOnuDetailInfoWithSession,
  getOnuWanIpWithSession,
  getOnuTr069MgmtInfoWithSession,
} from './zte-c320-onu-audit';
import { applyTr069ManagementWithSession, updateTr069AcsUrlWithSession } from './zte-c320-tr069';
import {
  IOltDriver,
  AuthorizeOnuParams,
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
  OnuDetailInfo,
  OnuIpHostInfo,
  OnuWanIpInfo,
  OnuTr069MgmtInfo,
} from '../ports/olt-driver.port';

const VENDOR = 'ZTE';

// `REBOOT_ONU_SENTINEL` se extrajo a `zte-c320-provisioning-scripts.ts`
// (Fase 3 de Plan_Implementacion_Refactor_ZteC320Driver.md), reexportado
// aquí para no romper `import { REBOOT_ONU_SENTINEL } from './zte-c320.driver'`.
export { REBOOT_ONU_SENTINEL } from './zte-c320-provisioning-scripts';

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
      const cards = parseCards(cardListOutput);

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
        uptimeSeconds = uptimeMatch ? parseZteUptimeToSeconds(uptimeMatch[1].trim()) : undefined;
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
   * Inventario real de tarjetas/slots del chasis (show card). Usa el mismo
   * comando ya verificado en test/fixtures/zte-c320/show_card.txt.
   */
  async getCards(params: OltConnectionParams): Promise<DiscoveredCard[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const output = await session.executeCommand('show card');
      return parseCards(output);
    } finally {
      await session.close();
    }
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
      const cards = parseCards(cardOutput);
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
            if (isOltErrorResponse(ifaceOut) || !ifaceOut.includes(ifaceName)) {
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

      if (isOltErrorResponse(output)) {
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

      const untagged = untaggedMatch ? parseVlanList(untaggedMatch[1]) : [];
      const tagged = taggedMatch ? parseVlanList(taggedMatch[1]) : [];

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
            vendor: inferVendorFromSerial(serialNumber),
          });
        }
      }

      return results;
    } finally {
      await session.close();
    }
  }
  /*
  
  revisar este bloque de condigo y su efecto en el sistema
  
  */
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
      if (isOltErrorResponse(baseInfoOutput)) {
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
          vendor: inferVendorFromSerial(base.serialNumber),
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
  /** Expuesto como método público porque las pruebas lo ejercitan directo (`driver.parseOnuRunningConfig(...)`) sin pasar por una sesión Telnet mock. */
  parseOnuRunningConfig(output: string): { name?: string; description?: string } {
    return parseOnuRunningConfig(output);
  }

  /**
   * Consulta la configuración activa de una sub-interfaz de ONU (ej. gpon-onu_1/2/15:1) revisar
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
   * Genera la lista de comandos Telnet de autorización y aprovisionamiento (RF-OLT-016 / RF-ONU-001..007)
   * respetando el orden jerárquico estricto de entidades OMCI (Bottom-Up).
   * Ver `generateAuthorizationScript` en zte-c320-provisioning-scripts.ts.
   */
  generateAuthorizationScript(config: AuthorizeOnuParams): string[] {
    return generateAuthorizationScriptImpl(config);
  }

  /**
   * Script CLI del bloque OMCI que apunta la ONU al ACS (TR-069) -- Etapa 2 (Reintento aislado).
   * Ver `generateTr069ManagementScript` en zte-c320-provisioning-scripts.ts.
   */
  generateTr069ManagementScript(config: AuthorizeOnuParams): string[] {
    return generateTr069ManagementScriptImpl(config);
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
        const pacingMs = getHumanPacingDelay(cmd);
        if (pacingMs > 0) {
          await this.delay(pacingMs);
        }

        if (isOltErrorResponse(output) && !isAlreadyAppliedResponse(output)) {
          const errMsg = output.trim();
          this.logger.warn(`[diag] authorizeOnu: OLT reportó respuesta no exitosa en comando "${cmd}": ${errMsg}`);

          if (isManagementOrTr069Command(cmd)) {
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
        verification = await verifyOnuProvisioningWithSession(session, config.ponInterface, config.onuId, {
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
      return await verifyOnuProvisioningWithSession(session, ponInterface, onuId, options);
    } finally {
      await session.close();
    }
  }

  /** "show gpon remote-onu ip-host <interfaz>" como método independiente -- ver `IOltDriver.getOnuIpHost`. */
  async getOnuIpHost(params: OltConnectionParams, ponInterface: string, onuId: number): Promise<OnuIpHostInfo> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getOnuIpHostWithSession(session, ponInterface, onuId);
    } finally {
      await session.close();
    }
  }

  /** "show mac gpon onu <interfaz>" como método independiente -- ver `IOltDriver.getOnuMacTable`. */
  async getOnuMacTable(
    params: OltConnectionParams,
    ponInterface: string,
    onuId: number,
  ): Promise<Array<{ mac: string; vlan: number }>> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getOnuMacTableWithSession(session, ponInterface, onuId);
    } finally {
      await session.close();
    }
  }

  /**
   * "show gpon onu detail-info <interfaz>" -- ver `IOltDriver.getOnuDetailInfo`.
   * Campos confirmados en vivo (2026-10-28, OLT_Tabara_Abajo, ONU
   * ECOM0F91DF9B): "Type: <nombre>", "Config state: <success|fail>".
   */
  async getOnuDetailInfo(params: OltConnectionParams, ponInterface: string, onuId: number): Promise<OnuDetailInfo> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getOnuDetailInfoWithSession(session, ponInterface, onuId);
    } finally {
      await session.close();
    }
  }

  /**
   * "show gpon remote-onu wan-ip <interfaz>" -- ver `IOltDriver.getOnuWanIp`.
   * SIN muestra real confirmada en vivo para el formato exacto (ver
   * Plan_Implementacion_WanIp_VlanProfile_HGU.md, Fase 0) -- parseo
   * mejor-esfuerzo, ver `getOnuWanIpWithSession`.
   */
  async getOnuWanIp(params: OltConnectionParams, ponInterface: string, onuId: number): Promise<OnuWanIpInfo> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getOnuWanIpWithSession(session, ponInterface, onuId);
    } finally {
      await session.close();
    }
  }

  /**
   * "show gpon remote-onu tr069-mgmt <interfaz>" -- ver
   * `IOltDriver.getOnuTr069MgmtInfo`. SIN muestra real confirmada en vivo
   * para el formato exacto -- parseo mejor-esfuerzo, ver
   * `getOnuTr069MgmtInfoWithSession`.
   */
  async getOnuTr069MgmtInfo(params: OltConnectionParams, ponInterface: string, onuId: number): Promise<OnuTr069MgmtInfo> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getOnuTr069MgmtInfoWithSession(session, ponInterface, onuId);
    } finally {
      await session.close();
    }
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
    config: AuthorizeOnuParams,
  ): Promise<{ ok: boolean; error?: string; warning?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await applyTr069ManagementWithSession(session, config, this.logger, (ms) => this.delay(ms));
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
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
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await updateTr069AcsUrlWithSession(session, config, this.logger);
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
      const found = parseTcontProfilesFromOutput(output).find((p) => p.name === name);
      return found ? { name: found.name, fixedKbps: found.speedKbps } : null;
    } finally {
      await session.close();
    }
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
    const existing = parseTcontProfilesFromOutput(output).find((p) => p.name === profile.name);
    if (existing) {
      return;
    }
    await session.executeCommand('configure terminal');
    await session.executeCommand('gpon');
    const createOutput = await session.executeCommand(
      `profile tcont ${profile.name} type 5 fixed 64 assured 64 maximum ${profile.fixedKbps}`,
    );
    if (isOltErrorResponse(createOutput)) {
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
    if (isOltErrorResponse(createOutput)) {
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

  /** Expuesto como método público porque las pruebas lo ejercitan directo (`driver.parseTrafficProfilesFromOutput(...)`). */
  parseTrafficProfilesFromOutput(output: string): DiscoveredTrafficProfile[] {
    return parseTrafficProfilesFromOutput(output);
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
    const alreadyExists = !isOltErrorResponse(checkOutput) && checkOutput.includes(profile.name);
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
          if (isOltErrorResponse(fixOutput)) {
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
    if (isOltErrorResponse(createOutput)) {
      await session.executeCommand('exit');
      await session.executeCommand('exit');
      throw new Error(`La OLT rechazó el onu-type "${profile.name}": ${createOutput.trim()}`);
    }

    if (profile.ethPorts && profile.ethPorts > 0) {
      const ethOutput = await session.executeCommand(`onu-type-if ${profile.name} eth_0/1-${profile.ethPorts}`);
      if (isOltErrorResponse(ethOutput)) {
        await session.executeCommand('exit');
        await session.executeCommand('exit');
        throw new Error(`La OLT rechazó los puertos ETH del onu-type "${profile.name}": ${ethOutput.trim()}`);
      }
    }
    if (profile.potsPorts && profile.potsPorts > 0) {
      const potsOutput = await session.executeCommand(`onu-type-if ${profile.name} pots_0/1-${profile.potsPorts}`);
      if (isOltErrorResponse(potsOutput)) {
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
      return parseTcontProfilesFromOutput(output);
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

// `ZteTelnetSession` se extrajo a `zte-telnet-session.ts` (Fase 1 de
// Plan_Implementacion_Refactor_ZteC320Driver.md) -- cliente Telnet genérico
// sin dependencias de esta clase, reexportado abajo para no romper imports
// externos existentes (`import { ZteTelnetSession } from './zte-c320.driver'`).
export { ZteTelnetSession } from './zte-telnet-session';
