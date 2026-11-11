import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { OnuWebProxyController } from './onu-web-proxy.controller';
import { OnuWebProxyService } from '../services/onu-web-proxy.service';
import { CpeSessionStoreService } from '../services/cpe-session-store.service';

describe('OnuWebProxyController', () => {
  let controller: OnuWebProxyController;
  let proxyService: jest.Mocked<Pick<OnuWebProxyService, 'verifySessionToken' | 'createWebSession'>>;
  let sessionStore: CpeSessionStoreService;

  beforeEach(() => {
    proxyService = {
      verifySessionToken: jest.fn(),
      createWebSession: jest.fn(),
    } as any;
    sessionStore = new CpeSessionStoreService();
    controller = new OnuWebProxyController(proxyService as any, sessionStore);
  });

  const mockRes = () => {
    const res: any = { redirectedTo: undefined, redirect(_status: number, url: string) { this.redirectedTo = url; } };
    return res;
  };

  it('lanza BadRequestException si falta el token', async () => {
    await expect(controller.launchWebSession(undefined as any, {} as any, mockRes())).rejects.toThrow(BadRequestException);
  });

  it('lanza UnauthorizedException si el token es inválido o expiró', async () => {
    proxyService.verifySessionToken.mockReturnValue(null);
    await expect(controller.launchWebSession('bad-token', {} as any, mockRes())).rejects.toThrow(UnauthorizedException);
  });

  it('crea una sesión en el store y redirige a /cpe/<sessionId><defaultPath>, SIN fijar ninguna cookie', async () => {
    proxyService.verifySessionToken.mockReturnValue({
      onuId: 'onu-1',
      serialNumber: 'HWTC7BDC60D9',
      targetIp: '192.168.44.250',
      port: 80,
      userId: 'user-1',
      defaultPath: '/webcmcc/index.html',
    });
    const res = mockRes();

    await controller.launchWebSession('valid-token', {} as any, res);

    expect(res.redirectedTo).toMatch(/^\/cpe\/[a-f0-9]+\/webcmcc\/index\.html$/);
    const sessionId = res.redirectedTo.split('/')[2];
    expect(sessionStore.get(sessionId)).toEqual({
      onuId: 'onu-1',
      serialNumber: 'HWTC7BDC60D9',
      targetIp: '192.168.44.250',
      port: 80,
      userId: 'user-1',
    });
  });

  it('dos lanzamientos de ONUs distintas producen sessionIds distintos (el bug real que esto corrige)', async () => {
    proxyService.verifySessionToken
      .mockReturnValueOnce({ onuId: 'onu-A', serialNumber: 'CMDCDD4D131E', targetIp: '10.46.69.246', port: 80, userId: 'u1', defaultPath: '/webcmcc/index.html' })
      .mockReturnValueOnce({ onuId: 'onu-B', serialNumber: 'HWTCD53E8C8A', targetIp: '10.15.153.200', port: 80, userId: 'u1', defaultPath: '/webcmcc/index.html' });

    const resA = mockRes();
    const resB = mockRes();
    await controller.launchWebSession('token-a', {} as any, resA);
    await controller.launchWebSession('token-b', {} as any, resB);

    expect(resA.redirectedTo).not.toBe(resB.redirectedTo);
    const idA = resA.redirectedTo.split('/')[2];
    const idB = resB.redirectedTo.split('/')[2];
    expect(sessionStore.get(idA)?.targetIp).toBe('10.46.69.246');
    expect(sessionStore.get(idB)?.targetIp).toBe('10.15.153.200');
  });
});
