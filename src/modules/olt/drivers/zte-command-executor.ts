import { performance } from 'perf_hooks';
import type { ZteSessionLike } from './zte-telnet-session';
import { isOltErrorResponse } from './zte-c320-parsers';
import { redactOltCli } from '../utils/redact-olt-cli';
import { assertOltIoOwnership } from '../utils/olt-telnet-mutex';

export type ZteMode = 'exec' | 'config' | 'interface' | 'onu' | 'unknown';
export function parseZtePrompt(prompt: string): ZteMode {
  if (/\(gpon-onu-mng\)#$/.test(prompt)) return 'onu';
  if (/\(config-if\)#$/.test(prompt)) return 'interface';
  if (/\(config\)#$/.test(prompt)) return 'config';
  if (/^[\w.-]+#$/.test(prompt)) return 'exec';
  return 'unknown';
}
export class ZteCommandError extends Error {
  constructor(public readonly code: string, message: string, public readonly indeterminate = false) { super(message); }
}
export class ZteCommandExecutor {
  private readonly started = performance.now();
  private poisoned = false;
  private mode: ZteMode = 'unknown';
  mutations = 0;
  attempts = 0;
  constructor(
    private readonly session: ZteSessionLike,
    private readonly delay: (ms: number) => Promise<void>,
    private readonly secrets: Array<string | undefined> = [],
    private readonly budgetMs = 240000,
    private readonly operationRemainingMs?: () => number,
  ) {}
  remaining(): number { return Math.max(0, Math.min(this.budgetMs - (performance.now() - this.started), this.operationRemainingMs?.() ?? Infinity)); }
  isUsable(): boolean { return !this.poisoned && this.remaining() > 0; }
  safe(value: string): string { return redactOltCli(value, this.secrets); }
  async pause(ms: number): Promise<void> {
    if (this.remaining() < ms) throw new ZteCommandError('DEADLINE', 'Se agotó el presupuesto de la operación.', true);
    await this.delay(ms);
  }
  async run(cmd: string, expected: ZteMode = 'exec', options: { absentOk?: boolean; pacingMs?: number } = {}): Promise<string> {
    await assertOltIoOwnership();
    if (!this.isUsable()) throw new ZteCommandError('SESSION_UNKNOWN', 'La sesión no permite continuar; se requiere una nueva lectura.', true);
    if (/^(?:no\s+)?ip\s+dhcp\s+snooping\b|^reboot\b|^__SUMTECH_/i.test(cmd)) {
      throw new ZteCommandError('FORBIDDEN_COMMAND', 'El aprovisionamiento no permite reinicios ni políticas globales.');
    }
    const read = /^show\s/.test(cmd);
    const context = /^(?:configure terminal|interface |pon-onu-mng |exit$|end$)/.test(cmd);
    const mutation = !read && !context && cmd !== 'write';
    const required = cmd === 'configure terminal' ? 'exec'
      : /^(?:interface |pon-onu-mng )/.test(cmd) ? 'config' : mutation ? expected : undefined;
    if (required && this.mode !== required) throw new ZteCommandError('CLI_CONTEXT', 'El comando no corresponde al contexto CLI observado.');
    const timeout = Math.min(20000, Math.floor(this.remaining()));
    if (timeout < 1) throw new ZteCommandError('DEADLINE', 'Se agotó el presupuesto de la operación.', true);
    this.attempts++;
    let output: string;
    try {
      if (this.session.executeCommandDetailed) {
        const result = await this.session.executeCommandDetailed(cmd, timeout);
        output = result.output;
        if (result.mode !== expected) {
          this.poisoned = true;
          throw new ZteCommandError('CLI_CONTEXT', `La CLI no terminó en el modo ${expected}.`, true);
        }
      } else {
        // Adaptador para sesiones de terceros y dobles de prueba.
        output = await this.session.executeCommand(cmd, timeout);
      }
    } catch (err) {
      this.poisoned = true;
      if (mutation) this.mutations++;
      if (err instanceof ZteCommandError) throw err;
      throw new ZteCommandError('IO_UNKNOWN', this.safe(String((err as Error)?.message || 'Comunicación interrumpida.')), true);
    }
    this.mode = expected;
    if (isOltErrorResponse(output) || /(?:invalid command|invalid syntax|syntax error|permission denied|not authorized|unknown command|unrecognized command)/i.test(output)) {
      if (options.absentOk && /^no /.test(cmd) && /(?:does not exist|not exist|not found)/i.test(output) &&
          !/(?:invalid|permission|authorized)/i.test(output)) return output;
      throw new ZteCommandError('CLI_REJECTED', this.safe(`La OLT rechazó ${cmd}: ${output.trim()}`));
    }
    if (mutation) this.mutations++;
    const pacing = options.pacingMs ?? (cmd === 'write' ? 1200 : context ? 350 : read ? 0 : 1200);
    if (pacing) await this.pause(pacing);
    return output;
  }
}
