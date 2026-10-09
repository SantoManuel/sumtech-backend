import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OltPermissionGuard, OLT_ACTION_KEY, OLT_ID_SOURCE_KEY } from './olt-permission.guard';
import { Role } from '../../../common/enums/role.enum';

describe('OltPermissionGuard', () => {
  let guard: OltPermissionGuard;
  let reflector: Reflector;
  let permRepo: any;
  let onuRepo: any;

  beforeEach(() => {
    reflector = new Reflector();
    permRepo = {
      findOneBy: jest.fn(),
    };
    onuRepo = {
      findOneBy: jest.fn(),
    };
    guard = new OltPermissionGuard(reflector, permRepo, onuRepo);
  });

  /** Mockea getAllAndOverride distinguiendo por metadata key, como lo hace Nest realmente. */
  const mockMetadata = (action: string | undefined, idSource?: string) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === OLT_ACTION_KEY) return action;
      if (key === OLT_ID_SOURCE_KEY) return idSource;
      return undefined;
    });
  };

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
    mockMetadata('CONFIGURE');
    const ctx = createMockContext({ role: Role.ADMIN });

    const allowed = await guard.canActivate(ctx);

    expect(allowed).toBe(true);
    expect(permRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('bloquea a CAJERO automáticamente', async () => {
    mockMetadata('VIEW');
    const ctx = createMockContext({ role: Role.CAJERO });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('permite a TECNICO operar si no tiene regla restrictiva pero bloquea configuración troncal (ruta OLT directa)', async () => {
    mockMetadata('CONFIGURE');
    permRepo.findOneBy.mockResolvedValue(null);
    const ctx = createMockContext({ role: Role.TECNICO }, { id: 'olt-1' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      /Los técnicos pueden operar OLTs pero no cambiar su configuración troncal/,
    );
  });

  it('respeta la matriz granular de net.olt_role_permissions (ruta OLT directa)', async () => {
    mockMetadata('OPERATE');
    permRepo.findOneBy.mockResolvedValue({ canOperate: false });
    const ctx = createMockContext({ role: Role.TECNICO }, { id: 'olt-1' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(/No tiene permisos para operar esta OLT/);
  });

  describe('@OltIdFrom(ONU_ID_PARAM) — rutas de onu.controller.ts donde :id es el ONU, no la OLT', () => {
    it('resuelve el oltId real a partir del ONU en vez de usar params.id directamente', async () => {
      mockMetadata('CONFIGURE', 'ONU_ID_PARAM');
      onuRepo.findOneBy.mockResolvedValue({ id: 'onu-99', oltId: 'olt-real-1' });
      permRepo.findOneBy.mockResolvedValue({ canConfigure: true });
      const ctx = createMockContext({ role: Role.TECNICO }, { id: 'onu-99' });

      const allowed = await guard.canActivate(ctx);

      expect(allowed).toBe(true);
      expect(onuRepo.findOneBy).toHaveBeenCalledWith({ id: 'onu-99' });
      expect(permRepo.findOneBy).toHaveBeenCalledWith({ oltId: 'olt-real-1', role: Role.TECNICO });
    });

    it('un TECNICO con permiso explícito canConfigure=true en su OLT puede previsualizar/autorizar un ONU (regresión del bug real)', async () => {
      mockMetadata('CONFIGURE', 'ONU_ID_PARAM');
      onuRepo.findOneBy.mockResolvedValue({ id: 'onu-1', oltId: 'olt-hioso-1' });
      permRepo.findOneBy.mockResolvedValue({ canConfigure: true });
      const ctx = createMockContext({ role: Role.TECNICO }, { id: 'onu-1' });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('sin regla explícita, sigue aplicando el default restrictivo de TECNICO para CONFIGURE, ya con el oltId correcto', async () => {
      mockMetadata('CONFIGURE', 'ONU_ID_PARAM');
      onuRepo.findOneBy.mockResolvedValue({ id: 'onu-1', oltId: 'olt-hioso-1' });
      permRepo.findOneBy.mockResolvedValue(null);
      const ctx = createMockContext({ role: Role.TECNICO }, { id: 'onu-1' });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        /Los técnicos pueden operar OLTs pero no cambiar su configuración troncal/,
      );
      expect(permRepo.findOneBy).toHaveBeenCalledWith({ oltId: 'olt-hioso-1', role: Role.TECNICO });
    });

    it('si el ONU no existe, no bloquea artificialmente (deja pasar, igual que ausencia de oltId en el flujo original)', async () => {
      mockMetadata('VIEW', 'ONU_ID_PARAM');
      onuRepo.findOneBy.mockResolvedValue(null);
      const ctx = createMockContext({ role: Role.TECNICO }, { id: 'onu-inexistente' });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });
});
