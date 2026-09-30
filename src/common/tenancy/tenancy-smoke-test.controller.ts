import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from '../decorators/public.decorator';
import { ClientEntity } from '../../modules/clients/entities/client.entity';

// Smoke test reutilizable del motor de tenancy (Fase 1). Pasa por
// TenantResolutionMiddleware como cualquier ruta de negocio real, pero usa
// TenantTypeOrmModule.forFeature([ClientEntity]) para demostrar que el Proxy
// de repositorio resuelve la DB correcta según el Host de la petición, sin
// que los módulos de negocio reales (Fase 2) hayan sido tocados todavía.
// Público a propósito (sin @UseGuards) para poder probarlo con un curl simple
// sin necesitar un JWT de tenant — se deja documentado como fixture útil
// para la verificación de la Fase 2, que reutilizará el mismo mecanismo.
@Controller('tenancy-smoke-test')
export class TenancySmokeTestController {
  constructor(
    @InjectRepository(ClientEntity)
    private readonly clientRepository: Repository<ClientEntity>,
  ) {}

  @Public()
  @Get('clients')
  async listClients() {
    const clients = await this.clientRepository.find({ select: ['id', 'name', 'docNumber'] });
    return { count: clients.length, clients };
  }
}
