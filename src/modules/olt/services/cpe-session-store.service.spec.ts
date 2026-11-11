import { CpeSessionStoreService } from './cpe-session-store.service';

describe('CpeSessionStoreService', () => {
  let store: CpeSessionStoreService;

  beforeEach(() => {
    store = new CpeSessionStoreService();
  });

  it('crea una sesión y la recupera con los mismos datos', () => {
    const id = store.create({
      onuId: 'onu-1',
      serialNumber: 'HWTC7BDC60D9',
      targetIp: '192.168.44.250',
      port: 80,
      userId: 'user-1',
    });

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(10);
    expect(store.get(id)).toEqual({
      onuId: 'onu-1',
      serialNumber: 'HWTC7BDC60D9',
      targetIp: '192.168.44.250',
      port: 80,
      userId: 'user-1',
    });
  });

  it('da sessionIds distintos para dos ONUs abiertas en paralelo (el bug real: antes compartían una sola cookie)', () => {
    const idA = store.create({ onuId: 'onu-A', serialNumber: 'CMDCDD4D131E', targetIp: '10.46.69.246', port: 80, userId: 'user-1' });
    const idB = store.create({ onuId: 'onu-B', serialNumber: 'HWTCD53E8C8A', targetIp: '10.15.153.200', port: 80, userId: 'user-1' });

    expect(idA).not.toBe(idB);
    expect(store.get(idA)?.targetIp).toBe('10.46.69.246');
    expect(store.get(idB)?.targetIp).toBe('10.15.153.200');
  });

  it('devuelve null para un sessionId inexistente', () => {
    expect(store.get('no-existe')).toBeNull();
  });

  it('expira la sesión después de su TTL', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const id = store.create({ onuId: 'onu-1', serialNumber: 'S1', targetIp: '1.2.3.4', port: 80, userId: 'u1' });
    expect(store.get(id)).not.toBeNull();

    jest.setSystemTime(new Date('2026-01-01T02:00:01Z')); // 2h + 1s
    expect(store.get(id)).toBeNull();
    jest.useRealTimers();
  });
});
