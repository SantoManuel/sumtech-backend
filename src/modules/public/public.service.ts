import { Injectable } from '@nestjs/common';
import { PlansService } from '../plans/plans.service';
import { CrmService } from '../crm/crm.service';
import { RequestLeadDto } from './dto/request-lead.dto';

@Injectable()
export class PublicService {
  constructor(
    private readonly plansService: PlansService,
    private readonly crmService: CrmService,
  ) {}

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
}
