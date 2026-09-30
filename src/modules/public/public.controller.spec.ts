import { Test, TestingModule } from '@nestjs/testing';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { PublicChatService } from './public-chat.service';
import { PublicGpsService } from './public-gps.service';
import { PublicSurveyService } from './public-survey.service';
import { ThrottlerModule } from '@nestjs/throttler';

describe('PublicController', () => {
  let controller: PublicController;
  let publicService: any;
  let publicChatService: any;
  let publicGpsService: any;
  let publicSurveyService: any;

  beforeEach(async () => {
    publicService = {
      getPublicPlans: jest.fn().mockResolvedValue([{ id: 'p1', name: 'Plan 1' }]),
      getSiteContent: jest.fn().mockResolvedValue({ name: 'Sumtech ISP', siteContent: {} }),
      getFeaturedPlans: jest.fn().mockResolvedValue([{ id: 'p2', name: 'Plan Featured' }]),
      getPublicCoverageZones: jest.fn().mockResolvedValue([{ id: 'z1', name: 'Zona Centro' }]),
      getPublicSectors: jest.fn().mockResolvedValue([{ id: 's1', name: 'Sector Norte' }]),
      createLead: jest.fn().mockResolvedValue({ success: true, leadId: 'lead-1' }),
    };
    publicChatService = {};
    publicGpsService = {};
    publicSurveyService = {};

    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60, limit: 10 }])],
      controllers: [PublicController],
      providers: [
        { provide: PublicService, useValue: publicService },
        { provide: PublicChatService, useValue: publicChatService },
        { provide: PublicGpsService, useValue: publicGpsService },
        { provide: PublicSurveyService, useValue: publicSurveyService },
      ],
    }).compile();

    controller = module.get<PublicController>(PublicController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('getSiteContent debe delegar a publicService.getSiteContent', async () => {
    const res = await controller.getSiteContent();
    expect(publicService.getSiteContent).toHaveBeenCalled();
    expect(res.name).toBe('Sumtech ISP');
  });

  it('getCoverageZones debe delegar a publicService.getPublicCoverageZones', async () => {
    const res = await controller.getCoverageZones();
    expect(publicService.getPublicCoverageZones).toHaveBeenCalled();
    expect(res).toEqual([{ id: 'z1', name: 'Zona Centro' }]);
  });

  it('getPublicSectors debe pasar query params a publicService.getPublicSectors', async () => {
    const res = await controller.getPublicSectors('mun-123', 'Centro');
    expect(publicService.getPublicSectors).toHaveBeenCalledWith('mun-123', 'Centro');
    expect(res).toEqual([{ id: 's1', name: 'Sector Norte' }]);
  });

  it('createLead debe delegar el DTO a publicService.createLead', async () => {
    const dto = { name: 'Ana', phone: '809-111-2222', sector: 'Azua' };
    const res = await controller.createLead(dto as any);
    expect(publicService.createLead).toHaveBeenCalledWith(dto);
    expect(res.success).toBe(true);
  });
});
