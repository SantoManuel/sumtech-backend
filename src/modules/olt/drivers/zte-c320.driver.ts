import * as net from 'net';
import { Injectable, Logger } from '@nestjs/common';
import {
  IOltDriver,
  OltConnectionParams,
  OltSystemInfo,
  DiscoveredInterface,
  ConfigureVlanParams,
} from '../ports/olt-driver.port';

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
   * Descubre las interfaces activas (show card + show interface gpon-olt_1/X/Y).
   */
  async discoverInterfaces(params: OltConnectionParams): Promise<DiscoveredInterface[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const cardOutput = await session.executeCommand('show card');
      const interfaces: DiscoveredInterface[] = [];

      // Detectar slots GPON desde `show card` (ej. GTGO = 8 puertos, GTGH = 16 puertos)
      const slotMatches = cardOutput.matchAll(/^\s*1\s+(\d+)\s+(\w+)\s+(REAL_\w+|\w+)?\s+(\w+)/gim);
      const gponSlots: Array<{ slot: number; cardType: string; ports: number }> = [];

      for (const m of slotMatches) {
        const slot = parseInt(m[1], 10);
        const cardType = m[2].toUpperCase();
        const status = (m[4] || '').toUpperCase();

        if (status.includes('INSERVICE') || status.includes('OK') || status.includes('ONLINE')) {
          if (cardType.startsWith('GTG') || cardType.startsWith('GFG')) {
            const ports = cardType === 'GTGO' ? 8 : 16;
            gponSlots.push({ slot, cardType, ports });
          }
        }
      }

      // Si no se detectaron tarjetas explícitas (ej. simulador o OLT compacta), escanear slot 1 y 2
      if (gponSlots.length === 0) {
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

      // Agregar puertos Uplink GEI estándar de ZTE C320 (Slot 3 o 4: gei_1/3/1 a gei_1/3/4)
      for (let p = 1; p <= 4; p++) {
        interfaces.push({
          name: `gei_1/3/${p}`,
          type: 'UPLINK',
          slot: 3,
          port: p,
          adminState: 'UP',
          operState: 'UP',
        });
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

          let vendor = 'Desconocido';
          const upperSn = serialNumber.toUpperCase();
          if (upperSn.startsWith('ZTEG')) vendor = 'ZTE';
          else if (upperSn.startsWith('HWTC')) vendor = 'Huawei';
          else if (upperSn.startsWith('VSOL')) vendor = 'VSOL';
          else if (upperSn.startsWith('ALCL')) vendor = 'Nokia/Alcatel';
          else if (upperSn.startsWith('FHTT')) vendor = 'Fiberhome';

          results.push({
            ponInterface: ponIface,
            onuIndex,
            serialNumber,
            vendor,
          });
        }
      }

      return results;
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
      'exit',
    ];

    if (config.managementMethod === 'TR069' && config.tr069Url) {
      commands.push(
        `pon-onu-mng ${config.ponInterface}:${config.onuId}`,
        `tr069-mgmt 1 acs ${config.tr069Url} tag pri 2 vlan ${config.tr069Vlan || config.serviceVlan}`,
        'exit',
      );
    }

    commands.push('write');
    return commands;
  }

  /**
   * Ejecuta el aprovisionamiento de la ONU en la OLT.
   */
  async authorizeOnu(
    params: OltConnectionParams,
    config: import('../ports/olt-driver.port').AuthorizeOnuParams,
  ): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
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
}

/**
 * Sesión Telnet de bajo nivel para ZTE C320 con protocolo IAC (RFC 854),
 * bypass de paginación (--More--), saneamiento ANSI y detección de prompts.
 */
class ZteTelnetSession {
  private socket: net.Socket | null = null;
  private prompt = 'ZXAN#';
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

      let loginStep: 'WAIT_USER' | 'WAIT_PASS' | 'WAIT_PROMPT' = 'WAIT_USER';

      socket.on('data', (raw: Buffer) => {
        const cleaned = this.handleIac(raw);
        this.buffer += cleaned.toString('ascii');

        // Paginación Telnet ZTE: si aparece --More--, enviar barra espaciadora
        if (this.buffer.includes('--More--') || this.buffer.toLowerCase().includes('-- more --')) {
          this.buffer = this.buffer.replace(/--More--/gi, '');
          socket.write(' ');
          return;
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

    return new Promise<string>((resolve, reject) => {
      let output = '';
      this.buffer = '';

      let finished = false;
      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          socket.removeListener('data', onData);
          reject(new Error(`Timeout ejecutando comando OLT: "${command}"`));
        }
      }, timeoutMs);

      const onData = (raw: Buffer) => {
        const cleaned = this.handleIac(raw);
        const chunk = cleaned.toString('ascii');
        output += chunk;

        if (output.includes('--More--') || output.toLowerCase().includes('-- more --')) {
          output = output.replace(/--More--/gi, '');
          socket.write(' ');
          return;
        }

        const lines = output.split('\n');
        const lastLine = lines[lines.length - 1]?.trim() || '';

        if (lastLine.endsWith('#') || lastLine.endsWith(')#' )) {
          finished = true;
          clearTimeout(timer);
          socket.removeListener('data', onData);

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
