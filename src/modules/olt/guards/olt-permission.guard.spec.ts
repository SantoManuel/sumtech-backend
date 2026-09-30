import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OltPermissionGuard } from './olt-permission.guard';
import { Role } from '../../../common/enums/role.enum';

describe('OltPermissionGuard', () => {
  let guard: OltPermissionGuard;
  let reflector: Reflector;
  let permRepo: any;

  beforeEach(() => {
    reflector = new Reflector();
    permRepo = {
      findOneBy: jest.fn(),
    };
    guard = new OltPermissionGuard(reflector, permRepo);
  });

  const createMockContext = (user: any, params: any = {}, body: any = {}): ExecutionContext => {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user, params, body }),
      }),
    } as unknown as ExecutionContext;
  };

  it('permite acceso total a ADMIN sin consultar base de datos', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('CONFIGURE');
    const ctx = createMockContext({ role: Role.ADMIN });

    const allowed = await guard.canActivate(ctx);

    expect(allowed).toBe(true);
    expect(permRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('bloquea a CAJERO automáticamente', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('VIEW');
    const ctx = createMockContext({ role: Role.CAJERO });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('permite a TECNICO operar si no tiene regla restrictiva pero bloquea configuración troncal', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('CONFIGURE');
    permRepo.findOneBy.mockResolvedValue(null);
    const ctx = createMockContext({ role: Role.TECNICO }, { id: 'olt-1' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      /Los técnicos pueden operar OLTs pero no cambiar su configuración troncal/,
    );
  });

  it('respeta la matriz granular de net.olt_role_permissions', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('OPERATE');
    permRepo.findOneBy.mockResolvedValue({ canOperate: false });
    const ctx = createMockContext({ role: Role.TECNICO }, { id: 'olt-1' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(/No tiene permisos para operar esta OLT/);
  });
});
