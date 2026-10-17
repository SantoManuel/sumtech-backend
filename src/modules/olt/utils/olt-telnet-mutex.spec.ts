import { withOltTelnetLock } from './olt-telnet-mutex';

describe('withOltTelnetLock', () => {
  it('serializa dos llamadas contra la misma OLT -- la segunda espera a que termine la primera', async () => {
    const order: string[] = [];
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const first = withOltTelnetLock('olt-1', async () => {
      order.push('first-start');
      await delay(50);
      order.push('first-end');
      return 'first-result';
    });

    const second = withOltTelnetLock('olt-1', async () => {
      order.push('second-start');
      await delay(10);
      order.push('second-end');
      return 'second-result';
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe('first-result');
    expect(secondResult).toBe('second-result');
    // "second-start" NUNCA debe intercalarse antes de "first-end" -- esa es
    // justo la colisión real confirmada en producción (dos sesiones Telnet
    // concurrentes contra la misma OLT).
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  it('NO serializa llamadas contra OLTs distintas -- pueden correr en paralelo', async () => {
    const order: string[] = [];
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const oltA = withOltTelnetLock('olt-a', async () => {
      order.push('a-start');
      await delay(50);
      order.push('a-end');
    });
    const oltB = withOltTelnetLock('olt-b', async () => {
      order.push('b-start');
      await delay(10);
      order.push('b-end');
    });

    await Promise.all([oltA, oltB]);

    // "b-end" ocurre ANTES de "a-end" -- prueba que no se bloquearon entre sí
    expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'));
  });

  it('si la primera llamada falla, la segunda igual se ejecuta (el lock no queda trabado)', async () => {
    const second = jest.fn().mockResolvedValue('ok');

    await expect(
      withOltTelnetLock('olt-2', async () => {
        throw new Error('fallo simulado de Telnet');
      }),
    ).rejects.toThrow('fallo simulado de Telnet');

    const result = await withOltTelnetLock('olt-2', second);
    expect(result).toBe('ok');
    expect(second).toHaveBeenCalled();
  });
});
