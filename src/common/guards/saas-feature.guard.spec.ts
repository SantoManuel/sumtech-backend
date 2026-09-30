import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SaasFeatureGuard } from './saas-feature.guard';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { REQUIRE_FEATURE_KEY } from '../decorators/require-feature.decorator';

describe('SaasFeatureGuard', () => {
  let guard: SaasFeatureGuard;
  let reflector: Reflector;
  let tenantContext: any;
  let context: ExecutionContext;

  beforeEach(() => {
    reflector = new Reflector();
    tenantContext = {
      hasContext: jest.fn().mockReturnValue(true),
      hasFeature: jest.fn().mockReturnValue(true),
    };
    guard = new SaasFeatureGuard(reflector, tenantContext as TenantContextService);

    context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;
  });

  it('permite el acceso si la ruta no tiene el decorador @RequireFeature', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const result = guard.canActivate(context);
    expect(result).toBe(true);
    expect(tenantContext.hasFeature).not.toHaveBeenCalled();
  });

  it('permite el acceso si no hay contexto de tenant activo', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('GENIEACS');
    tenantContext.hasContext.mockReturnValue(false);

    const result = guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('permite el acceso si el plan del tenant incluye el feature requerido', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('GENIEACS');
    tenantContext.hasFeature.mockReturnValue(true);

    const result = guard.canActivate(context);
    expect(result).toBe(true);
    expect(tenantContext.hasFeature).toHaveBeenCalledWith('GENIEACS');
  });

  it('bloquea con ForbiddenException si el plan del tenant NO incluye el feature requerido', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('GENIEACS');
    tenantContext.hasFeature.mockReturnValue(false);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow(/GENIEACS/);
  });
});
