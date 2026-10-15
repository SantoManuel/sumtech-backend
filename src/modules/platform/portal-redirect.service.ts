import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NodePortalRegistryEntity } from './entities/node-portal-registry.entity';
import { TenantEntity } from './entities/tenant.entity';

/**
 * Resuelve a qué tenant redirigir a un cliente suspendido en modo Portal de
 * Aviso (NOTICE_PORTAL) -- ver NodePortalRegistryEntity para el porqué de
 * identificar por IP de origen en vez de por Host. Un solo endpoint público
 * y genérico (PortalRedirectController) sirve para cualquier cantidad de
 * tenants sin tocar Traefik ni redesplegar nada por cada alta nueva.
 */
@Injectable()
export class PortalRedirectService {
  private readonly logger = new Logger(PortalRedirectService.name);

  constructor(
    @InjectRepository(NodePortalRegistryEntity, 'platform')
    private readonly registryRepository: Repository<NodePortalRegistryEntity>,
    @InjectRepository(TenantEntity, 'platform')
    private readonly tenantRepository: Repository<TenantEntity>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Dada la IP de origen de la petición (la del router, por el masquerade de
   * salida), devuelve la URL completa a la que redirigir, o null si ninguna
   * IP pública registrada matchea (router de un tenant que todavía no
   * configuró publicIp, o tráfico que no viene de un cliente suspendido real).
   */
  async resolveRedirectUrl(sourceIp: string | undefined): Promise<string | null> {
    if (!sourceIp) {
      return null;
    }

    const entry = await this.registryRepository.findOneBy({ publicIp: sourceIp });
    if (!entry) {
      this.logger.debug(`Sin match de portal cautivo para la IP de origen ${sourceIp}`);
      return null;
    }

    const tenant = await this.tenantRepository.findOneBy({ id: entry.tenantId });
    if (!tenant) {
      this.logger.warn(`El registro de portal cautivo apunta a un tenant inexistente (tenantId=${entry.tenantId})`);
      return null;
    }

    return this.buildAvisoUrl(tenant.slug);
  }

  private buildAvisoUrl(slug: string): string {
    const rawRootDomain = this.configService.get<string>('SAAS_ROOT_DOMAIN') || 'localhost:3000';
    const rootDomain = rawRootDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const isLocal = rootDomain.includes('localhost') || rootDomain.includes('127.0.0.1');
    const protocol = isLocal ? 'http' : 'https';
    return `${protocol}://${slug}.${rootDomain}/aviso`;
  }
}
