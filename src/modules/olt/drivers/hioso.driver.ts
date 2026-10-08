import * as net from 'net';
import { Injectable, Logger } from '@nestjs/common';
import {
  IOltDriver,
  OltConnectionParams,
  OltSystemInfo,
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
 * testConnection, getSystemInfo, discoverInterfaces. El resto sigue
 * lanzando DriverNotImplementedError porque requieren sintaxis de
 * configuración (VLAN, autorización de ONU) que no se ha podido validar
 * de forma segura sin un ONU físico conectado — ver getCapabilities().
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

  async getOnuOpticalPower(params: OltConnectionParams, onuTarget: string): Promise<OnuOpticalPower> {
    throw new DriverNotImplementedError(VENDOR, 'getOnuOpticalPower');
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
      discoverInterfaces: true,
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
