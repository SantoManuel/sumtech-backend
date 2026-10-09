import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OltRolePermissionEntity } from '../entities/olt-role-permission.entity';
import { OnuEntity } from '../entities/onu.entity';
import { Role } from '../../../common/enums/role.enum';

export type OltAction = 'VIEW' | 'OPERATE' | 'CONFIGURE';
export const OLT_ACTION_KEY = 'olt_action';
export const RequireOltAction = (action: OltAction) => SetMetadata(OLT_ACTION_KEY, action);

/**
 * Por default, @RequireOltAction asume que `:id` en la ruta ES el id de la
 * OLT (ej. olts/:id). Las rutas de onu.controller.ts también usan `:id`,
 * pero ahí `:id` es el id del ONU — usar ese valor directo como oltId hacía
 * que el guard nunca encontrara la OltRolePermissionEntity real (buscaba un
 * "olt_id" que en realidad era un onu id), cayendo siempre en el default
 * restrictivo por rol. @OltIdFrom('ONU_ID_PARAM') le dice al guard que
 * resuelva el oltId real cargando el ONU referenciado por `:id`.
 */
export type OltIdSource = 'OLT_ID_PARAM' | 'ONU_ID_PARAM';
export const OLT_ID_SOURCE_KEY = 'olt_id_source';
export const OltIdFrom = (source: OltIdSource) => SetMetadata(OLT_ID_SOURCE_KEY, source);

@Injectable()
export class OltPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(OltRolePermissionEntity)
    private readonly permRepository: Repository<OltRolePermissionEntity>,
    @InjectRepository(OnuEntity)
    private readonly onuRepository: Repository<OnuEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredAction = this.reflector.getAllAndOverride<OltAction>(OLT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredAction) {
      return true; // No exige restricción de OLT
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Usuario no autenticado.');
    }

    // ADMIN y GERENTE tienen control total sin restricciones
    if (user.role === Role.ADMIN || user.role === Role.GERENTE) {
      return true;
    }

    // CAJERO no tiene acceso a OLTs
    if (user.role === Role.CAJERO) {
      throw new ForbiddenException('Su rol no tiene autorización para acceder a la gestión de OLTs.');
    }

    const idSource = this.reflector.getAllAndOverride<OltIdSource>(OLT_ID_SOURCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    let oltId: string | undefined;
    if (idSource === 'ONU_ID_PARAM') {
      const onuId = request.params.id;
      if (onuId) {
        const onu = await this.onuRepository.findOneBy({ id: onuId });
        oltId = onu?.oltId;
      }
    } else {
      oltId = request.params.id || request.body?.oltId;
    }

    if (!oltId) {
      return true;
    }

    const perm = await this.permRepository.findOneBy({
      oltId,
      role: user.role,
    });

    if (!perm) {
      // Si no hay regla específica, aplicar defaults por rol
      if (user.role === Role.TECNICO) {
        if (requiredAction === 'CONFIGURE') {
          throw new ForbiddenException('Los técnicos pueden operar OLTs pero no cambiar su configuración troncal.');
        }
        return true;
      }
      if (user.role === Role.AGENTE_CRM) {
        if (requiredAction !== 'VIEW') {
          throw new ForbiddenException('Los agentes CRM solo tienen permiso de lectura sobre OLTs.');
        }
        return true;
      }
      throw new ForbiddenException('Acceso no permitido para este rol sobre la OLT.');
    }

    if (requiredAction === 'VIEW' && !perm.canView) {
      throw new ForbiddenException('No tiene permisos para ver esta OLT.');
    }
    if (requiredAction === 'OPERATE' && !perm.canOperate) {
      throw new ForbiddenException('No tiene permisos para operar esta OLT.');
    }
    if (requiredAction === 'CONFIGURE' && !perm.canConfigure) {
      throw new ForbiddenException('No tiene permisos para modificar la configuración de esta OLT.');
    }

    return true;
  }
}
