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
  DiscoveredUncfgOnu,
  OnuOpticalPower,
  AuthorizeOnuParams,
  OltDriverCapabilities,
  NO_DRIVER_CAPABILITIES,
  DriverNotImplementedError,
} from '../ports/olt-driver.port';

const VENDOR = 'HIOSO';

/**
 * Driver para HiOSO (probado contra HAT7304VXD-ADC, firmware V1.1.21).
 *
 * Solo las operaciones cubiertas por reconocimiento real de CLI (ver
 * test/fixtures/hioso/cli_command_tree.txt) están implementadas:
 * testConnection, getSystemInfo, getSystemHealth, discoverInterfaces,
 * getOnuOpticalPower. El resto sigue lanzando DriverNotImplementedError:
 * getCards() porque este hardware no tiene chasis modular (no hay comando
 * equivalente a "show card"), y VLAN/autorización de ONU porque requieren
 * comandos de configuración que todavía no se han ejecutado contra el
 * equipo real — ver getCapabilities().
 */
@Injectable()
export class HiosoDriver implements IOltDriver {
  private readonly logger = new Logger(HiosoDriver.name);

  protected createSession(params: OltConnectionParams): {
    connectAndLogin(): Promise<void>;
    executeCommand(cmd: string, timeoutMs?: number): Promise<string>;
    close(): void;
  } {
    return new HiosoTelnetSession(params);
  }

  async testConnection(params: OltConnectionParams): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    const start = Date.now();
    let session: any = null;
    try {
      session = this.createSession(params);
      await session.connectAndLogin();
      const latencyMs = Date.now() - start;
      return { ok: true, latencyMs };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Error de conexión Telnet con OLT HiOSO' };
    } finally {
      if (session) {
        session.close();
      }
    }
  }

  /**
   * show version + show system. El equipo no reporta un "modelo" explícito
   * por CLI (no hay campo tipo "HAT7304VXD-ADC" en ninguna salida) — se usa
   * System Description tal cual lo reporta el propio equipo.
   */
  async getSystemInfo(params: OltConnectionParams): Promise<OltSystemInfo> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const rawVersion = await session.executeCommand('show version');
      const rawSystem = await session.executeCommand('show system');

      const versionMatch = rawVersion.match(/Version\s*:\s*(\S+)/i);
      const firmwareVersion = versionMatch ? versionMatch[1] : undefined;

      const uptimeMatch = rawSystem.match(/System Up Time\s*:\s*(.+)/i);
      const uptime = uptimeMatch ? uptimeMatch[1].trim() : '—';

      const descriptionMatch = rawSystem.match(/System Description\s*:\s*(.+)/i);
      const model = descriptionMatch ? descriptionMatch[1].trim() : 'EPON OLT';

      return {
        vendor: 'HiOSO',
        model,
        uptime,
        firmwareVersion,
        rawSystemGroup: `${rawVersion}\n${rawSystem}`.slice(0, 500),
      };
    } finally {
      session.close();
    }
  }

  /**
   * show process cpu + show memory + show system. CPU y memoria vienen de
   * comandos reales verificados (ver test/fixtures/hioso/show_process_cpu.txt
   * y show_memory.txt). La temperatura del chasis NO se incluye: la única
   * temperatura verificada en este equipo es la del transceptor SFP
   * ("show epon <IF> optical-ddm"), una métrica distinta (óptica, no de
   * chasis) — no se debe confundir ni inventar un valor de chasis que nunca
   * se ha observado.
   */
  async getSystemHealth(params: OltConnectionParams): Promise<OltSystemHealth> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const rawCpu = await session.executeCommand('show process cpu');
      const rawMemory = await session.executeCommand('show memory');
      const rawSystem = await session.executeCommand('show system');

      const cpuMatch = rawCpu.match(/CPU Utilization in the past 5 seconds\s*:\s*(\d+)%/i);
      const cpuUsagePercent = cpuMatch ? parseInt(cpuMatch[1], 10) : undefined;

      const freeMatch = rawMemory.match(/Free\s+(\d+)/i);
      const usedMatch = rawMemory.match(/Used\s+(\d+)/i);
      const totalMatch = rawMemory.match(/Total\s+(\d+)/i);
      const memoryUsagePercent =
        usedMatch && totalMatch && parseInt(totalMatch[1], 10) > 0
          ? Math.round((parseInt(usedMatch[1], 10) / parseInt(totalMatch[1], 10)) * 100)
          : undefined;

      const uptimeMatch = rawSystem.match(/System Up Time\s*:\s*(.+)/i);
      const uptimeSeconds = uptimeMatch ? this.parseUptimeToSeconds(uptimeMatch[1].trim()) : undefined;

      return {
        cpuUsagePercent,
        memoryUsagePercent,
        uptimeSeconds,
        raw: `${rawCpu}\n${rawMemory}`.slice(0, 500),
      };
    } finally {
      session.close();
    }
  }

  /**
   * Parsea el formato de "System Up Time" observado realmente en este equipo
   * ("1h 54m 38s"). No se ha visto un formato con días en la evidencia real
   * (el equipo lleva menos de un día encendido) — el parser acepta un token
   * "Nd" opcional por si aparece, pero esto no está verificado.
   */
  private parseUptimeToSeconds(raw: string): number | undefined {
    const dayMatch = raw.match(/(\d+)d/i);
    const hourMatch = raw.match(/(\d+)h/i);
    const minuteMatch = raw.match(/(\d+)m/i);
    const secondMatch = raw.match(/(\d+)s/i);

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
   * Este equipo (HAT7304VXD-ADC) no tiene chasis modular con tarjetas/slots
   * intercambiables — es una unidad compacta de 4 puertos EPON. No hay
   * comando real equivalente a "show card" de ZTE para esta familia de
   * hardware, así que esta capacidad queda sin implementar (no "no aplica"
   * silenciosamente — getCapabilities().chassisCards queda en false).
   */
  async getCards(params: OltConnectionParams): Promise<DiscoveredCard[]> {
    throw new DriverNotImplementedError(VENDOR, 'getCards');
  }

  /**
   * show interfaces status. Parsea los bloques "Information of <Interfaz>".
   *
   * ASUNCIÓN DOCUMENTADA (no viene de un comando separado): esta salida no
   * trae un campo distinto para estado administrativo vs. operacional — solo
   * "Link Status". Se asume adminState='UP' salvo evidencia explícita de
   * "shutdown" en el bloque, porque no se ha verificado cómo luce un puerto
   * administrativamente apagado en este equipo (no se forzó un shutdown real
   * durante el reconocimiento). registeredOnus/inputBps/outputBps no están
   * disponibles en este comando y se dejan sin definir.
   */
  async discoverInterfaces(params: OltConnectionParams): Promise<DiscoveredInterface[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const output = await session.executeCommand('show interfaces status');
      return this.parseInterfacesStatus(output);
    } finally {
      session.close();
    }
  }

  private parseInterfacesStatus(output: string): DiscoveredInterface[] {
    const interfaces: DiscoveredInterface[] = [];
    const blocks = output.split(/Information of /i).slice(1);

    for (const block of blocks) {
      const headerLine = block.split('\n')[0].trim();
      const slotPortMatch = headerLine.match(/(\d+)\/(\d+)\s*$/);
      if (!slotPortMatch) {
        continue;
      }
      const slot = parseInt(slotPortMatch[1], 10);
      const port = parseInt(slotPortMatch[2], 10);

      let type: DiscoveredInterface['type'];
      let name: string;
      if (/^Epon\b/i.test(headerLine)) {
        type = 'PON';
        name = `epon ${slot}/${port}`;
      } else if (/^Ten-Gigabit Ethernet\b/i.test(headerLine)) {
        type = 'UPLINK';
        name = `ten-gigabitethernet ${slot}/${port}`;
      } else if (/^Gigabit Ethernet\b/i.test(headerLine)) {
        type = 'UPLINK';
        name = `gigabitethernet ${slot}/${port}`;
      } else {
        continue;
      }

      const shutdownMentioned = /shutdown/i.test(block);
      const adminState: 'UP' | 'DOWN' = shutdownMentioned ? 'DOWN' : 'UP';

      const linkStatusMatch = block.match(/Link Status\s*:\s*(\w+)/i);
      const operState: 'UP' | 'DOWN' = linkStatusMatch && /up/i.test(linkStatusMatch[1]) ? 'UP' : 'DOWN';

      interfaces.push({ name, type, slot, port, adminState, operState });
    }

    return interfaces;
  }

  async configureVlanOnInterface(params: OltConnectionParams, config: ConfigureVlanParams): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: new DriverNotImplementedError(VENDOR, 'configureVlanOnInterface').message };
  }

  async getUnconfiguredOnus(params: OltConnectionParams, ponInterface?: string): Promise<DiscoveredUncfgOnu[]> {
    throw new DriverNotImplementedError(VENDOR, 'getUnconfiguredOnus');
  }

  /**
   * show onu optical-ddm epon <IF> <onu-id>. onuTarget llega como
   * "<nombre de interfaz>:<onu-id>" (ej. "epon 1/1:2"), mismo patrón que
   * usa OnuManagementService para los demás fabricantes.
   *
   * Verificado contra un ONU real conectado (ver
   * test/fixtures/hioso/show_onu_optical-ddm_online.txt): cuando el ONU
   * está online el equipo SÍ reporta RxPower (potencia que el ONU recibe
   * del OLT) además de TxPower (potencia que el ONU transmite). No hay
   * forma de obtener la potencia que el OLT recibe DEL ONU (upRxDbm) ni
   * una atenuación calculada con este comando — esos campos quedan
   * `undefined`, no se inventan. Cuando el ONU no está online, el equipo
   * responde "! Onu X is offline!" o "! Onu X invalid" (dos mensajes
   * distintos, ver cli_command_tree.txt) y simplemente no hay campos que
   * parsear — se devuelve todo `undefined` con el mensaje crudo en `raw`.
   */
  async getOnuOpticalPower(params: OltConnectionParams, onuTarget: string): Promise<OnuOpticalPower> {
    const { iface, onuId } = this.parseOnuTarget(onuTarget);
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const output = await session.executeCommand(`show onu optical-ddm epon ${iface} ${onuId}`);

      const rxMatch = output.match(/RxPower\s*:\s*([-\d.]+)\s*dBm/i);
      const txMatch = output.match(/TxPower\s*:\s*([-\d.]+)\s*dBm/i);

      const rxDbm = rxMatch ? parseFloat(rxMatch[1]) : undefined;
      const txDbm = txMatch ? parseFloat(txMatch[1]) : undefined;

      return {
        rxDbm,
        txDbm,
        downRxDbm: rxDbm,
        raw: output.slice(0, 300),
      };
    } finally {
      session.close();
    }
  }

  /**
   * "<interfaz>:<onu-id>" -> { iface: "1/1", onuId: "2" }. El nombre de
   * interfaz que persiste discoverInterfaces() es "epon 1/1"; aquí se le
   * quita el prefijo "epon " porque el comando real ya lo incluye
   * ("show onu optical-ddm epon 1/1 2").
   */
  private parseOnuTarget(onuTarget: string): { iface: string; onuId: string } {
    const sep = onuTarget.lastIndexOf(':');
    if (sep === -1) {
      throw new Error(`onuTarget con formato inesperado para HiOSO: "${onuTarget}" (se esperaba "<interfaz>:<onu-id>")`);
    }
    const rawIface = onuTarget.slice(0, sep).trim();
    const onuId = onuTarget.slice(sep + 1).trim();
    const iface = rawIface.replace(/^epon\s+/i, '');
    return { iface, onuId };
  }

  async authorizeOnu(params: OltConnectionParams, config: AuthorizeOnuParams): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: new DriverNotImplementedError(VENDOR, 'authorizeOnu').message };
  }

  async setOnuAdminState(params: OltConnectionParams, onuTarget: string, state: 'ACTIVE' | 'BLOCKED'): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: new DriverNotImplementedError(VENDOR, 'setOnuAdminState').message };
  }

  async deleteOnu(params: OltConnectionParams, ponInterface: string, onuId: number): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: new DriverNotImplementedError(VENDOR, 'deleteOnu').message };
  }

  generateAuthorizationScript(config: AuthorizeOnuParams): string[] {
    throw new DriverNotImplementedError(VENDOR, 'generateAuthorizationScript');
  }

  getCapabilities(): OltDriverCapabilities {
    return {
      ...NO_DRIVER_CAPABILITIES,
      testConnection: true,
      systemInfo: true,
      systemHealth: true,
      discoverInterfaces: true,
      onuOpticalPower: true,
    };
  }
}

/**
 * Sesión Telnet de bajo nivel para HiOSO. A diferencia de ZTE, el login
 * aterriza en modo no privilegiado ("Epon> ") y requiere "enable" explícito
 * para llegar a "Epon# ". El marcador de paginación también es distinto
 * ("Enter Key To Continue" en vez de "--More--") y se continúa con un
 * salto de línea en blanco (verificado en reconocimiento real, no un --More--
 * tipo Cisco que se continúa con espacio).
 */
class HiosoTelnetSession {
  private socket: net.Socket | null = null;
  private buffer = '';

  constructor(private readonly params: OltConnectionParams) {}

  async connectAndLogin(): Promise<void> {
    const timeoutMs = this.params.timeoutMs || 15000;

    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      this.socket = socket;

      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          reject(new Error(`Timeout de conexión Telnet (${timeoutMs}ms) contra ${this.params.host}:${this.params.port}`));
        }
      }, timeoutMs);

      socket.connect(this.params.port, this.params.host, () => {
        // Conexión TCP establecida
      });

      let loginStep: 'WAIT_USER' | 'WAIT_PASS' | 'WAIT_UNPRIV_PROMPT' | 'WAIT_ENABLE_RESULT' = 'WAIT_USER';

      socket.on('data', (raw: Buffer) => {
        const cleaned = this.handleIac(raw);
        this.buffer += cleaned.toString('ascii');
        const trimmed = this.buffer.trim();

        if (loginStep === 'WAIT_USER' && /username:\s*$/i.test(trimmed)) {
          this.buffer = '';
          loginStep = 'WAIT_PASS';
          socket.write(`${this.params.username}\r\n`);
          return;
        }

        if (loginStep === 'WAIT_PASS' && /password:\s*$/i.test(trimmed)) {
          this.buffer = '';
          loginStep = 'WAIT_UNPRIV_PROMPT';
          socket.write(`${this.params.password}\r\n`);
          return;
        }

        if (loginStep === 'WAIT_UNPRIV_PROMPT' && />\s*$/.test(trimmed)) {
          this.buffer = '';
          loginStep = 'WAIT_ENABLE_RESULT';
          socket.write('enable\r\n');
          return;
        }

        if (loginStep === 'WAIT_ENABLE_RESULT') {
          if (/password:\s*$/i.test(trimmed)) {
            this.buffer = '';
            socket.write(`${this.params.enablePassword || ''}\r\n`);
            return;
          }
          if (/#\s*$/.test(trimmed)) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              this.buffer = '';
              resolve();
            }
            return;
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

    return new Promise<string>((resolve, reject) => {
      let output = '';
      this.buffer = '';

      let finished = false;
      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          socket.removeListener('data', onData);
          reject(new Error(`Timeout ejecutando comando OLT HiOSO: "${command}"`));
        }
      }, timeoutMs);

      const onData = (raw: Buffer) => {
        const cleaned = this.handleIac(raw);
        const chunk = cleaned.toString('ascii');
        output += chunk;

        if (/Enter Key To Continue/i.test(output)) {
          output = output.replace(/-*\s*Enter Key To Continue\s*-*/gi, '');
          socket.write('\r\n');
          return;
        }

        const lines = output.split('\n');
        const lastLine = lines[lines.length - 1]?.trim() || '';

        if (/#\s*$/.test(lastLine)) {
          finished = true;
          clearTimeout(timer);
          socket.removeListener('data', onData);

          const cleanLines = lines
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && !l.includes(command) && !/#\s*$/.test(l));

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
