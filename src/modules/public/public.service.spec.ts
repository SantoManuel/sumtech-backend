import { Test, TestingModule } from '@nestjs/testing';
import { PublicService } from './public.service';
import { PlansService } from '../plans/plans.service';
import { CrmService } from '../crm/crm.service';
import { CompanyService } from '../company/company.service';
import { ZonesService } from '../network/zones.service';
import { GeographyService } from '../geography/geography.service';

describe('PublicService', () => {
  let service: PublicService;
  let plansService: any;
  let crmService: any;
  let companyService: any;
  let zonesService: any;
  let geographyService: any;

  const mockProfile = {
    name: 'Sumtech Telecom',
    commercialName: 'Sumtech Fibra',
    logoUrl: 'https://sumtech.com/logo.png',
    website: 'https://sumtech.com',
    phone: '809-555-0100',
    supportEmail: 'soporte@sumtech.com',
    siteContent: {
      hero: { title: 'Internet Real', subtitle: 'Ultra rápido' },
      primaryColor: '#2FCB09',
    },
  };

  beforeEach(async () => {
    plansService = {
      findAll: jest.fn().mockResolvedValue([{ id: 'plan-1', name: 'Plan 20M' }]),
      findFeatured: jest.fn().mockResolvedValue([{ id: 'plan-2', name: 'Plan 50M' }]),
    };
    crmService = {
      create: jest.fn().mockResolvedValue({ id: 'opp-123', name: 'Juan Perez' }),
    };
    companyService = {
      getProfile: jest.fn().mockResolvedValue(mockProfile),
    };
    zonesService = {
      findAll: jest.fn().mockResolvedValue({
        data: [
          { id: 'zone-1', name: 'Azua Centro', description: 'Fibra Óptica GPON' },
          { id: 'zone-2', name: 'Pueblo Viejo', description: 'Red Inalámbrica y Fibra' },
        ],
        total: 2,
      }),
    };
    geographyService = {
      findSectors: jest.fn().mockResolvedValue([
        { id: 'sec-1', name: 'Pueblo Abajo', municipalityId: 'mun-1' },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicService,
        { provide: PlansService, useValue: plansService },
        { provide: CrmService, useValue: crmService },
        { provide: CompanyService, useValue: companyService },
        { provide: ZonesService, useValue: zonesService },
        { provide: GeographyService, useValue: geographyService },
      ],
    }).compile();

    service = module.get<PublicService>(PublicService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('getSiteContent debe resolver el contenido y branding del tenant', async () => {
    const res = await service.getSiteContent();
    expect(companyService.getProfile).toHaveBeenCalled();
    expect(res.name).toBe('Sumtech Telecom');
    expect(res.commercialName).toBe('Sumtech Fibra');
    expect(res.siteContent.primaryColor).toBe('#2FCB09');
  });

  it('getPublicPlans debe retornar solo los planes activos', async () => {
    const res = await service.getPublicPlans();
    expect(plansService.findAll).toHaveBeenCalledWith(undefined, true);
    expect(res).toEqual([{ id: 'plan-1', name: 'Plan 20M' }]);
  });

  it('getFeaturedPlans debe retornar los planes destacados', async () => {
    const res = await service.getFeaturedPlans();
    expect(plansService.findFeatured).toHaveBeenCalled();
    expect(res).toEqual([{ id: 'plan-2', name: 'Plan 50M' }]);
  });

  it('createLead debe crear una oportunidad en CRM con origen WEB_LANDING', async () => {
    const dto = {
      name: 'Carlos Ruiz',
      phone: '809-555-9988',
      email: 'carlos@example.com',
      sector: 'Pueblo Viejo',
      planInteres: 'Plan 30M',
      folio: 'SOL-123456',
    };

    const res = await service.createLead(dto);

    expect(crmService.create).toHaveBeenCalledWith({
      name: 'Carlos Ruiz',
      phone: '809-555-9988',
      email: 'carlos@example.com',
      planId: undefined,
      source: 'WEB_LANDING',
      notes: 'Sector de interés: Pueblo Viejo | Plan de interés: Plan 30M | Folio web: SOL-123456',
    });
    expect(res.success).toBe(true);
    expect(res.leadId).toBe('opp-123');
  });

  it('getPublicCoverageZones debe mapear y devolver las zonas activas del tenant', async () => {
    const zones = await service.getPublicCoverageZones();
    expect(zonesService.findAll).toHaveBeenCalledWith({ limit: 100 }, true);
    expect(zones).toHaveLength(2);
    expect(zones[0]).toEqual({
      id: 'zone-1',
      name: 'Azua Centro',
      description: 'Fibra Óptica GPON',
    });
  });

  it('getPublicSectors debe invocar geographyService.findSectors con filtro activo', async () => {
    const sectors = await service.getPublicSectors('mun-1', 'Pueblo');
    expect(geographyService.findSectors).toHaveBeenCalledWith({
      municipalityId: 'mun-1',
      search: 'Pueblo',
      activeOnly: true,
    });
    expect(sectors).toEqual([{ id: 'sec-1', name: 'Pueblo Abajo', municipalityId: 'mun-1' }]);
  });
});
