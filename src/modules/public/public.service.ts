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
    const opportunity = await this.crmService.create({
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      planId: dto.planId,
      source: 'WEB_LANDING',
      notes: `Sector de interés: ${dto.sector}`,
    });

    return {
      success: true,
      message: 'Solicitud recibida con éxito. Un asesor de Sumtech te contactará a la brevedad.',
      leadId: opportunity.id,
    };
  }
}
