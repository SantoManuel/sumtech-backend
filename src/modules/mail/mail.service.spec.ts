import { Test, TestingModule } from '@nestjs/testing';
import { MailerService } from '@nestjs-modules/mailer';
import { MailService } from './mail.service';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';
import { MailSettingsService } from './mail-settings.service';

describe('MailService', () => {
  let service: MailService;
  let mailerService: any;
  let tenantContext: any;
  let mailSettingsService: any;

  beforeEach(async () => {
    mailerService = {
      sendMail: jest.fn(),
      addTransporter: jest.fn(),
    };
    tenantContext = {
      hasContext: jest.fn().mockReturnValue(false),
      getSlug: jest.fn().mockReturnValue('sumtech'),
    };
    mailSettingsService = {
      getSettingsForSending: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: MailerService, useValue: mailerService },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: MailSettingsService, useValue: mailSettingsService },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('sin contexto de tenant, usa el transporte global (sin transporterName) — ej. welcome-tenant antes de que exista el tenant', async () => {
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
    expect(mailerService.addTransporter).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('con tenant activo pero SMTP propio deshabilitado, usa el transporte global', async () => {
    tenantContext.hasContext.mockReturnValue(true);
    mailSettingsService.getSettingsForSending.mockResolvedValue({ enabled: false, smtpHost: 'smtp.example.com' });
    mailerService.sendMail.mockResolvedValue({ messageId: 'msg-1' });

    await service.sendTemplatedMail({ to: 'a@b.com', subject: 'S', template: 't', context: {} });

    expect(mailerService.addTransporter).not.toHaveBeenCalled();
    expect(mailerService.sendMail).toHaveBeenCalledWith(
      expect.not.objectContaining({ transporterName: expect.anything() }),
    );
  });

  it('con tenant activo y SMTP propio habilitado, registra un transporter con el slug del tenant y lo usa, con el remitente propio', async () => {
    tenantContext.hasContext.mockReturnValue(true);
    tenantContext.getSlug.mockReturnValue('isp-azua');
    mailSettingsService.getSettingsForSending.mockResolvedValue({
      enabled: true,
      smtpHost: 'smtp.isp-azua.com',
      smtpPort: 465,
      smtpUser: 'no-reply@isp-azua.com',
      smtpPass: 'secreto',
      smtpSecure: true,
      fromAddress: '"ISP Azua" <no-reply@isp-azua.com>',
    });
    mailerService.sendMail.mockResolvedValue({ messageId: 'msg-1' });

    await service.sendTemplatedMail({ to: 'cliente@x.com', subject: 'S', template: 't', context: {} });

    expect(mailerService.addTransporter).toHaveBeenCalledWith(
      'isp-azua',
      expect.objectContaining({
        host: 'smtp.isp-azua.com',
        port: 465,
        secure: true,
        auth: { user: 'no-reply@isp-azua.com', pass: 'secreto' },
      }),
    );
    expect(mailerService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        transporterName: 'isp-azua',
        from: '"ISP Azua" <no-reply@isp-azua.com>',
      }),
    );
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

  it('si falla la resolución de configuración del tenant, cae al transporte global sin romper el envío', async () => {
    tenantContext.hasContext.mockReturnValue(true);
    mailSettingsService.getSettingsForSending.mockRejectedValue(new Error('DB caída'));
    mailerService.sendMail.mockResolvedValue({ messageId: 'msg-1' });

    const result = await service.sendTemplatedMail({ to: 'a@b.com', subject: 'S', template: 't', context: {} });

    expect(result).toBe(true);
    expect(mailerService.addTransporter).not.toHaveBeenCalled();
  });
});
