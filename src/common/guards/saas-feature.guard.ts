import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { REQUIRE_FEATURE_KEY } from '../decorators/require-feature.decorator';

@Injectable()
export class SaasFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredFeature = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredFeature) {
      return true;
    }

    if (!this.tenantContext.hasContext()) {
      return true;
    }

    const hasAccess = this.tenantContext.hasFeature(requiredFeature);
    if (!hasAccess) {
      throw new ForbiddenException(
        `Su plan SaaS actual no incluye acceso al módulo o funcionalidad '${requiredFeature}'. Comuníquese con el administrador de la plataforma para actualizar su plan.`,
      );
    }

    return true;
  }
}
