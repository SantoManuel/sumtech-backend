import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CrmSchedulerService } from './crm-scheduler.service';
import { OpportunityEntity } from './entities/opportunity.entity';
import { UserEntity } from '../users/entities/user.entity';
import { SatisfactionSurveyEntity } from './entities/satisfaction-survey.entity';
import { CrmService } from './crm.service';
import { MailService } from '../mail/mail.service';

describe('CrmSchedulerService', () => {
  let service: CrmSchedulerService;
  let opportunityRepo: any;
  let userRepo: any;
  let surveyRepo: any;
  let crmService: any;
  let mailService: any;
  let userQueryBuilder: any;
  let opportunityQueryBuilder: any;

  const agent = { id: 'agent-1', username: 'luis.crm', email: 'luis@sumtech.do', isActive: true };

  beforeEach(async () => {
    userQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([agent]),
    };
    opportunityQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    opportunityRepo = {
      createQueryBuilder: jest.fn(() => opportunityQueryBuilder),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    userRepo = {
      createQueryBuilder: jest.fn(() => userQueryBuilder),
      findOneBy: jest.fn().mockResolvedValue(agent),
    };
    surveyRepo = {
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'survey-1', ...entity })),
    };
    crmService = {
      findSlaBreaches: jest.fn().mockResolvedValue([]),
    };
    mailService = {
      sendTemplatedMail: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrmSchedulerService,
        { provide: getRepositoryToken(OpportunityEntity), useValue: opportunityRepo },
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: getRepositoryToken(SatisfactionSurveyEntity), useValue: surveyRepo },
        { provide: CrmService, useValue: crmService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get<CrmSchedulerService>(CrmSchedulerService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('sendDailyReminders', () => {
    it('envía un correo por agente activo con las oportunidades vencidas/que vencen hoy', async () => {
      opportunityQueryBuilder.getMany.mockResolvedValue([
        { name: 'Juan Pérez', nextAction: { name: 'Llamar para seguimiento' }, nextActionDate: '2020-01-01' },
      ]);

      await service.sendDailyReminders();

      expect(mailService.sendTemplatedMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: agent.email,
          template: 'crm-reminder',
          context: expect.objectContaining({ agentName: 'luis.crm', count: 1 }),
        }),
      );
    });

    it('no envía correo si el agente no tiene oportunidades pendientes hoy', async () => {
      opportunityQueryBuilder.getMany.mockResolvedValue([]);

      await service.sendDailyReminders();

      expect(mailService.sendTemplatedMail).not.toHaveBeenCalled();
    });

    it('omite agentes sin email configurado (no debería pasar, pero no debe explotar)', async () => {
      userQueryBuilder.getMany.mockResolvedValue([{ ...agent, email: '' }]);

      await service.sendDailyReminders();

      expect(mailService.sendTemplatedMail).not.toHaveBeenCalled();
    });
  });

  describe('sendSlaBreachAlerts', () => {
    it('agrupa los incumplimientos por agente asignado y envía un correo por agente', async () => {
      crmService.findSlaBreaches.mockResolvedValue([
        {
          opportunity: { name: 'Opp A', assignedUserId: 'agent-1', subscriptionStatus: { name: 'Prospecto' } },
          daysSinceUpdate: 5,
          maxDays: 3,
        },
        {
          opportunity: { name: 'Opp B', assignedUserId: 'agent-1', subscriptionStatus: { name: 'Prospecto' } },
          daysSinceUpdate: 6,
          maxDays: 3,
        },
      ]);

      await service.sendSlaBreachAlerts();

      expect(mailService.sendTemplatedMail).toHaveBeenCalledTimes(1);
      expect(mailService.sendTemplatedMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: agent.email, template: 'crm-sla-alert', context: expect.objectContaining({ count: 2 }) }),
      );
    });

    it('no hace nada si no hay incumplimientos de SLA', async () => {
      crmService.findSlaBreaches.mockResolvedValue([]);

      await service.sendSlaBreachAlerts();

      expect(mailService.sendTemplatedMail).not.toHaveBeenCalled();
      expect(userRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('ignora oportunidades sin agente asignado', async () => {
      crmService.findSlaBreaches.mockResolvedValue([
        { opportunity: { name: 'Sin asignar', assignedUserId: undefined, subscriptionStatus: { name: 'Prospecto' } }, daysSinceUpdate: 5, maxDays: 3 },
      ]);

      await service.sendSlaBreachAlerts();

      expect(mailService.sendTemplatedMail).not.toHaveBeenCalled();
    });
  });

  describe('sendSatisfactionSurveys', () => {
    it('crea el registro de encuesta con token y envía el correo al cliente, y limpia la próxima acción', async () => {
      opportunityQueryBuilder.getMany.mockResolvedValue([
        { id: 'opp-1', name: 'Ana Pérez', client: { name: 'Ana Pérez', email: 'ana@test.com' }, clientId: 'client-1' },
      ]);

      await service.sendSatisfactionSurveys();

      expect(surveyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ opportunityId: 'opp-1', status: 'PENDING', token: expect.any(String) }),
      );
      expect(surveyRepo.save).toHaveBeenCalled();
      expect(mailService.sendTemplatedMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'ana@test.com',
          template: 'crm-satisfaction-survey',
          context: expect.objectContaining({ clientName: 'Ana Pérez' }),
        }),
      );
      expect(opportunityRepo.update).toHaveBeenCalledWith('opp-1', { nextActionId: null, nextActionDate: null });
    });

    it('omite el envío (pero sigue sin explotar) si el cliente no tiene email', async () => {
      opportunityQueryBuilder.getMany.mockResolvedValue([
        { id: 'opp-1', name: 'Sin Email', client: { name: 'Sin Email', email: null }, clientId: 'client-1' },
      ]);

      await service.sendSatisfactionSurveys();

      expect(mailService.sendTemplatedMail).not.toHaveBeenCalled();
      expect(surveyRepo.create).not.toHaveBeenCalled();
    });

    it('limpia la próxima acción incluso si el envío del correo falla (no reintenta indefinidamente)', async () => {
      opportunityQueryBuilder.getMany.mockResolvedValue([
        { id: 'opp-1', name: 'Ana Pérez', client: { name: 'Ana Pérez', email: 'ana@test.com' }, clientId: 'client-1' },
      ]);
      mailService.sendTemplatedMail.mockResolvedValue(false);

      await service.sendSatisfactionSurveys();

      expect(opportunityRepo.update).toHaveBeenCalledWith('opp-1', { nextActionId: null, nextActionDate: null });
    });
  });
});
