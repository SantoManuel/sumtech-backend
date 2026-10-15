import { Test, TestingModule } from '@nestjs/testing';
import { PortalRedirectController } from './portal-redirect.controller';
import { PortalRedirectService } from './portal-redirect.service';

describe('PortalRedirectController', () => {
  let controller: PortalRedirectController;
  let service: any;

  const makeRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.type = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.redirect = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(async () => {
    service = { resolveRedirectUrl: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortalRedirectController],
      providers: [{ provide: PortalRedirectService, useValue: service }],
    }).compile();

    controller = module.get(PortalRedirectController);
  });

  it('redirige (302) a la URL resuelta usando X-Forwarded-For como IP de origen', async () => {
    service.resolveRedirectUrl.mockResolvedValue('https://sumtech.sumtech.com.do/aviso');
    const req: any = { headers: { 'x-forwarded-for': '200.1.2.3, 10.0.0.1' }, socket: {} };
    const res = makeRes();

    await controller.redirect(req, res);

    expect(service.resolveRedirectUrl).toHaveBeenCalledWith('200.1.2.3');
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://sumtech.sumtech.com.do/aviso');
  });

  it('usa x-real-ip si no hay x-forwarded-for', async () => {
    service.resolveRedirectUrl.mockResolvedValue(null);
    const req: any = { headers: { 'x-real-ip': '200.1.2.9' }, socket: {} };
    const res = makeRes();

    await controller.redirect(req, res);

    expect(service.resolveRedirectUrl).toHaveBeenCalledWith('200.1.2.9');
  });

  it('cae al remoteAddress del socket como último recurso', async () => {
    service.resolveRedirectUrl.mockResolvedValue(null);
    const req: any = { headers: {}, socket: { remoteAddress: '200.1.2.1' }, ip: '200.1.2.1' };
    const res = makeRes();

    await controller.redirect(req, res);

    expect(service.resolveRedirectUrl).toHaveBeenCalledWith('200.1.2.1');
  });

  it('muestra una página de aviso genérica (200) si no se pudo identificar al tenant', async () => {
    service.resolveRedirectUrl.mockResolvedValue(null);
    const req: any = { headers: {}, socket: {} };
    const res = makeRes();

    await controller.redirect(req, res);

    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('suspendido'));
  });
});
