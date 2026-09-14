import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from './auth.guard';

function buildContext(headers: Record<string, string>, request: any = {}): ExecutionContext {
  const req = { headers, ...request };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  let reflector: Reflector;
  let jwtService: jest.Mocked<Pick<JwtService, 'verify'>>;
  let configService: ConfigService;
  let guard: AuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    jwtService = { verify: jest.fn() };
    configService = { get: () => 'test-secret' } as unknown as ConfigService;
    guard = new AuthGuard(reflector, jwtService as unknown as JwtService, configService);
  });

  it('permite el paso sin validar token en rutas marcadas @Public()', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    const context = buildContext({});

    expect(guard.canActivate(context)).toBe(true);
    expect(jwtService.verify).not.toHaveBeenCalled();
  });

  it('lanza UnauthorizedException si no hay header Authorization', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    const context = buildContext({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('lanza UnauthorizedException si el header no tiene formato "Bearer <token>"', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    const context = buildContext({ authorization: 'Token abc123' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('lanza UnauthorizedException si el token es inválido o expiró', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    const context = buildContext({ authorization: 'Bearer token-invalido' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('con un token válido, permite el paso y adjunta el payload decodificado a request.user', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const payload = { sub: 'user-1', username: 'admin', email: 'admin@sumtech.com', roles: ['ADMIN'] };
    jwtService.verify.mockReturnValue(payload);

    const req: any = { headers: { authorization: 'Bearer token-valido' } };
    const context = buildContext(req.headers, req);

    expect(guard.canActivate(context)).toBe(true);
    expect(jwtService.verify).toHaveBeenCalledWith('token-valido', { secret: 'test-secret' });
  });
});
