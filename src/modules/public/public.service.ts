import { Injectable } from '@nestjs/common';
import { PlansService } from '../plans/plans.service';
import { CrmService } from '../crm/crm.service';
import { CompanyService } from '../company/company.service';
import { ZonesService } from '../network/zones.service';
import { GeographyService } from '../geography/geography.service';
import { RequestLeadDto } from './dto/request-lead.dto';

@Injectable()
export class PublicService {
  constructor(
    private readonly plansService: PlansService,
    private readonly crmService: CrmService,
    private readonly companyService: CompanyService,
    private readonly zonesService: ZonesService,
    private readonly geographyService: GeographyService,
  ) {}

  /**
   * Branding + contenido del sitio público del tenant activo (resuelto por
   * subdominio vía TenantResolutionMiddleware, igual que cualquier otro
   * endpoint) — Fase 5/7 del plan multi-tenant lo consumen para de-hardcodear
   * el sitio comercial de `sumtech_landingPage_TeleAzua`.
   */
  async getSiteContent() {
    const profile = await this.companyService.getProfile();
    return {
      name: profile.name,
      commercialName: profile.commercialName || profile.name,
      logoUrl: profile.logoUrl,
      website: profile.website,
      phone: profile.phone,
      supportEmail: profile.supportEmail,
      siteContent: profile.siteContent || {},
    };
  }

  async getPublicPlans() {
    return this.plansService.findAll(undefined, true);
  }

  async getFeaturedPlans() {
    return this.plansService.findFeatured();
  }

  async createLead(dto: RequestLeadDto) {
    const notesParts = [`Sector de interés: ${dto.sector}`];
    if (dto.planInteres) notesParts.push(`Plan de interés: ${dto.planInteres}`);
    if (dto.folio) notesParts.push(`Folio web: ${dto.folio}`);

    const opportunity = await this.crmService.create({
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      planId: dto.planId,
      source: 'WEB_LANDING',
      notes: notesParts.join(' | '),
    });

    return {
      success: true,
      message: 'Solicitud recibida con éxito. Un asesor de Sumtech te contactará a la brevedad.',
      leadId: opportunity.id,
    };
  }

  /**
   * Zonas de cobertura activas del tenant resuelto por subdominio (Fase 4/5).
   */
  async getPublicCoverageZones() {
    const result = await this.zonesService.findAll({ limit: 100 }, true);
    return result.data.map((zone) => ({
      id: zone.id,
      name: zone.name,
      description: zone.description,
    }));
  }

  /**
   * Sectores geográficos del tenant resuelto por subdominio para consulta pública.
   */
  async getPublicSectors(municipalityId?: string, search?: string) {
    return this.geographyService.findSectors({ municipalityId, search, activeOnly: true });
  }
}
