import * as net from 'net';
import { Logger } from '@nestjs/common';
import { OltConnectionParams } from '../ports/olt-driver.port';

/**
 * Forma mínima de sesión que consumen las funciones extraídas de
 * `ZteC320Driver` (auditoría, TR-069, perfiles, etc.) -- les basta con esto,
 * no necesitan la clase concreta `ZteTelnetSession`. `ZteTelnetSession` la
 * satisface por tipado estructural, sin declarar `implements` explícito.
 */
export interface ZteSessionLike {
  connectAndLogin(): Promise<void>;
  executeCommand(cmd: string, timeoutMs?: number): Promise<string>;
  rebootOnu(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

/**
 * Sesión Telnet de bajo nivel para ZTE C320 con protocolo IAC (RFC 854),
 * bypass de paginación (--More--), saneamiento ANSI y detección de prompts.
 *
 * Extraída de `zte-c320.driver.ts` (Fase 1 de
 * Plan_Implementacion_Refactor_ZteC320Driver.md) -- es un cliente Telnet
 * genérico sin ninguna dependencia de `ZteC320Driver`; este último la usa a
 * través de `createSession()`. Movida tal cual, sin cambios de
 * comportamiento.
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
