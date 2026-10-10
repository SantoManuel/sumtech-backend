import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MailSettingsController } from './mail-settings.controller';
import { MailSettingsService } from './mail-settings.service';
import { MailService } from './mail.service';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';

describe('MailSettingsController', () => {
  let controller: MailSettingsController;
  let mailSettingsService: any;
  let mailService: any;

  const mockSettings = {
    id: 'settings-1',
    enabled: false,
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUser: 'no-reply@example.com',
    smtpSecure: false,
    fromAddress: '"ISP" <no-reply@example.com>',
  };

  beforeEach(async () => {
    mailSettingsService = {
      getSettings: jest.fn().mockResolvedValue(mockSettings),
      update: jest.fn().mockResolvedValue({ ...mockSettings, enabled: true }),
    };
    mailService = {
      sendTemplatedMail: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MailSettingsController],
      providers: [
        { provide: MailSettingsService, useValue: mailSettingsService },
        { provide: MailService, useValue: mailService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('dev-secret') } },
        {
          provide: TenantContextService,
          useValue: { hasContext: jest.fn().mockReturnValue(true), getSlug: jest.fn().mockReturnValue('sumtech') },
        },
      ],
    }).compile();

    controller = module.get<MailSettingsController>(MailSettingsController);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('getSettings enmascara smtpPass con hasSmtpPass', async () => {
    mailSettingsService.getSettings.mockResolvedValueOnce({ ...mockSettings, smtpPass: 'secreto' });

    const res: any = await controller.getSettings();

    expect(res.hasSmtpPass).toBe(true);
    expect(res.smtpPass).toBeUndefined();
  });

  it('getSettings reporta hasSmtpPass=false cuando no hay contraseña guardada', async () => {
    const res: any = await controller.getSettings();
    expect(res.hasSmtpPass).toBe(false);
  });

  it('updateSettings delega en el service y enmascara la respuesta', async () => {
    const res: any = await controller.updateSettings({ enabled: true } as any);
    expect(mailSettingsService.update).toHaveBeenCalledWith({ enabled: true });
    expect(res.enabled).toBe(true);
    expect(res.smtpPass).toBeUndefined();
  });

  it('sendTest envía con el template smtp-test y reporta éxito', async () => {
    const res = await controller.sendTest({ to: 'destino@example.com' });

    expect(mailService.sendTemplatedMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'destino@example.com', template: 'smtp-test' }),
    );
    expect(res.success).toBe(true);
  });

  it('sendTest reporta fallo si el envío real falla', async () => {
    mailService.sendTemplatedMail.mockResolvedValueOnce(false);

    const res = await controller.sendTest({ to: 'destino@example.com' });

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/no se pudo enviar/i);
  });
});
