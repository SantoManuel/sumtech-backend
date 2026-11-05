import { ZteCommandExecutor, parseZtePrompt } from './zte-command-executor';
import { tr069Session } from './__fixtures__/tr069-state.fixture';

describe('ZTE command executor', () => {
  const delay = jest.fn().mockResolvedValue(undefined);
  it.each([['ZXAN#', 'exec'], ['ZXAN(config)#', 'config'], ['ZXAN(config-if)#', 'interface'], ['ZXAN(gpon-onu-mng)#', 'onu'], ['garbage#', 'exec'], ['ZXAN(other)#', 'unknown']])('parses %s', (prompt, mode) => expect(parseZtePrompt(prompt)).toBe(mode));
  it.each(['reboot', 'ip dhcp snooping enable', 'no ip dhcp snooping control-port'])('rejects forbidden configuration command %s before I/O', async cmd => {
    const session = tr069Session();
    await expect(new ZteCommandExecutor(session, delay).run(cmd)).rejects.toThrow('no permite');
    expect(session.executeCommand).not.toHaveBeenCalled();
  });
  it('requires observed CLI context before mutating', async () => {
    const session = tr069Session();
    await expect(new ZteCommandExecutor(session, delay).run('gemport 2 tcont 2', 'interface')).rejects.toThrow('contexto');
    expect(session.executeCommand).not.toHaveBeenCalled();
  });
  it('does not reuse a session after I/O uncertainty', async () => {
    const session = tr069Session({ failIo: 'show running-config' });
    const executor = new ZteCommandExecutor(session, delay);
    await expect(executor.run('show running-config')).rejects.toThrow('Timeout');
    await expect(executor.run('show vlan')).rejects.toThrow('sesión');
    expect(session.executeCommand).toHaveBeenCalledTimes(1);
  });
  it('checks the actual returned mode and does not retry 20200', async () => {
    const session = { ...tr069Session(), executeCommandDetailed: jest.fn().mockResolvedValue({ output: '', mode: 'exec', prompt: 'ZXAN#' }) };
    const executor = new ZteCommandExecutor(session, delay);
    await executor.run('show running-config');
    await expect(executor.run('configure terminal', 'config')).rejects.toThrow('modo config');
    expect(session.executeCommandDetailed).toHaveBeenCalledTimes(2);
  });
  it('enforces a real deadline including pacing', async () => {
    const session = tr069Session();
    await expect(new ZteCommandExecutor(session, delay, [], 0).run('show vlan')).rejects.toThrow();
    await expect(new ZteCommandExecutor(session, delay, [], 1).pause(5000)).rejects.toThrow('presupuesto');
    expect(session.executeCommand).not.toHaveBeenCalled();
  });
  it.each([['%Error 1: entry does not exist', true], ['%Error 1: Permission denied', false], ['%Error 20200: Invalid input', false]])('only tolerates confirmed absence: %s', async (output, tolerated) => {
    const session = tr069Session();
    const executor = new ZteCommandExecutor(session, delay);
    await executor.run('show running-config');
    await executor.run('configure terminal', 'config');
    await executor.run('interface gpon-onu_1/2/15:1', 'interface');
    session.executeCommand.mockResolvedValueOnce(output);
    const run = executor.run('no service-port 2', 'interface', { absentOk: true });
    if (tolerated) await expect(run).resolves.toBe(output); else await expect(run).rejects.toThrow();
  });
});
