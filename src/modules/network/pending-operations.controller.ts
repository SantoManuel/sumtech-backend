import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { ServiceControlService } from './service-control.service';

@Controller('network/pending-operations')
@UseGuards(AuthGuard, RolesGuard)
export class PendingOperationsController {
  constructor(private readonly serviceControlService: ServiceControlService) {}

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async getPendingOperations() {
    return this.serviceControlService.getPendingOperations();
  }

  @Post('retry')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async retryPendingOperations(@Body() body: { accessIds?: string[] }) {
    if (body.accessIds && body.accessIds.length > 0) {
      const results: Array<{ accessId: string; ok: boolean; result?: any; error?: string }> = [];
      for (const id of body.accessIds) {
        try {
          const res = await this.serviceControlService.applyPending(id);
          results.push({ accessId: id, ok: true, result: res });
        } catch (err: any) {
          results.push({ accessId: id, ok: false, error: err.message });
        }
      }
      return results;
    }

    // Si no se envían IDs específicos, reintentar todas las operaciones pendientes
    const pendings = await this.serviceControlService.getPendingOperations();
    const results: Array<{ accessId: string; ok: boolean; result?: any; error?: string }> = [];
    for (const access of pendings) {
      try {
        const res = await this.serviceControlService.applyPending(access.id);
        results.push({ accessId: access.id, ok: true, result: res });
      } catch (err: any) {
        results.push({ accessId: access.id, ok: false, error: err.message });
      }
    }
    return results;
  }
}
