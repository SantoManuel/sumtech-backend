import { Test, TestingModule } from '@nestjs/testing';
import { MailerService } from '@nestjs-modules/mailer';
import { MailService } from './mail.service';

describe('MailService', () => {
  let service: MailService;
  let mailerService: any;

  beforeEach(async () => {
    mailerService = {
      sendMail: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [MailService, { provide: MailerService, useValue: mailerService }],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('sendTemplatedMail delega en MailerService.sendMail con to/subject/template/context y devuelve true si tiene éxito', async () => {
    mailerService.sendMail.mockResolvedValue({ messageId: 'msg-1' });

    const result = await service.sendTemplatedMail({
      to: 'agente@sumtech.do',
      subject: 'Recordatorio',
      template: 'crm-reminder',
      context: { agentName: 'Luis', count: 2 },
    });

    expect(mailerService.sendMail).toHaveBeenCalledWith({
      to: 'agente@sumtech.do',
      subject: 'Recordatorio',
      template: 'crm-reminder',
      context: { agentName: 'Luis', count: 2 },
    });
    expect(result).toBe(true);
  });

  it('sendTemplatedMail devuelve false y no propaga el error si el SMTP falla (credenciales inválidas, red caída, etc.)', async () => {
    mailerService.sendMail.mockRejectedValue(new Error('Invalid login: 535-5.7.8'));

    const result = await service.sendTemplatedMail({
      to: 'agente@sumtech.do',
      subject: 'Recordatorio',
      template: 'crm-reminder',
      context: {},
    });

    expect(result).toBe(false);
  });
});
