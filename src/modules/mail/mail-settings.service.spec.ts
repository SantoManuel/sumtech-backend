import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { MailSettingsService } from './mail-settings.service';
import { MailSettingsEntity } from './entities/mail-settings.entity';

describe('MailSettingsService', () => {
  let service: MailSettingsService;
  let settingsRepo: any;

  beforeEach(async () => {
    settingsRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => Promise.resolve({ id: 'settings-1', ...dto })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [MailSettingsService, { provide: getRepositoryToken(MailSettingsEntity), useValue: settingsRepo }],
    }).compile();

    service = module.get<MailSettingsService>(MailSettingsService);
  });

  describe('getSettings', () => {
    it('devuelve la fila existente si ya hay una', async () => {
      settingsRepo.findOne.mockResolvedValue({ id: 'settings-1', enabled: true });

      const result = await service.getSettings();

      expect(result).toEqual({ id: 'settings-1', enabled: true });
      expect(settingsRepo.create).not.toHaveBeenCalled();
    });

    it('crea una fila mínima (deshabilitada) si todavía no existe ninguna — get-or-create', async () => {
      settingsRepo.findOne.mockResolvedValue(null);

      const result = await service.getSettings();

      expect(settingsRepo.create).toHaveBeenCalledWith({ enabled: false, smtpPort: 587, smtpSecure: false });
      expect(result.enabled).toBe(false);
    });
  });

  describe('update', () => {
    it('no toca smtpPass si llega vacío/omitido — "vacío = conservar la contraseña actual"', async () => {
      settingsRepo.findOne.mockResolvedValue({
        id: 'settings-1',
        enabled: false,
        smtpHost: 'smtp.old.com',
        smtpPass: 'ya-guardada-en-memoria-tras-decrypt',
      });

      await service.update({ smtpHost: 'smtp.new.com', smtpPass: '' } as any);

      const saved = settingsRepo.save.mock.calls[0][0];
      expect(saved.smtpHost).toBe('smtp.new.com');
      expect(saved.smtpPass).toBe('ya-guardada-en-memoria-tras-decrypt');
    });

    it('reemplaza smtpPass si llega un valor no vacío', async () => {
      settingsRepo.findOne.mockResolvedValue({ id: 'settings-1', enabled: false, smtpPass: 'vieja' });

      await service.update({ smtpPass: 'nueva-contraseña' } as any);

      const saved = settingsRepo.save.mock.calls[0][0];
      expect(saved.smtpPass).toBe('nueva-contraseña');
    });

    it('rechaza habilitar sin host/usuario/remitente completos', async () => {
      settingsRepo.findOne.mockResolvedValue({ id: 'settings-1', enabled: false });

      await expect(service.update({ enabled: true } as any)).rejects.toThrow(BadRequestException);
    });

    it('permite habilitar cuando host, usuario y remitente están completos', async () => {
      settingsRepo.findOne.mockResolvedValue({
        id: 'settings-1',
        enabled: false,
        smtpHost: 'smtp.example.com',
        smtpUser: 'no-reply@example.com',
        fromAddress: '"ISP" <no-reply@example.com>',
      });

      await expect(service.update({ enabled: true } as any)).resolves.toEqual(
        expect.objectContaining({ enabled: true }),
      );
    });
  });
});
