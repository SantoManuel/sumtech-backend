import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailSettingsEntity } from './entities/mail-settings.entity';
import { UpdateMailSettingsDto } from './dto/update-mail-settings.dto';

/**
 * Configuración SMTP de ESTE tenant — una sola fila por DB de tenant
 * (get-or-create, mismo criterio ya usado por CompanyService.getProfile():
 * singleton por convención de aplicación, sin constraint de unicidad en la
 * DB).
 */
@Injectable()
export class MailSettingsService {
  constructor(
    @InjectRepository(MailSettingsEntity)
    private readonly settingsRepository: Repository<MailSettingsEntity>,
  ) {}

  async getSettings(): Promise<MailSettingsEntity> {
    let settings = await this.settingsRepository.findOne({ where: {}, order: { createdAt: 'ASC' } });
    if (!settings) {
      settings = this.settingsRepository.create({ enabled: false, smtpPort: 587, smtpSecure: false });
      settings = await this.settingsRepository.save(settings);
    }
    return settings;
  }

  /**
   * Versión para uso interno de MailService (único consumidor que necesita
   * `smtpPass` en texto plano) — nunca exponer el resultado de este método
   * directamente a un controller/respuesta HTTP.
   */
  async getSettingsForSending(): Promise<MailSettingsEntity> {
    return this.getSettings();
  }

  async update(dto: UpdateMailSettingsDto): Promise<MailSettingsEntity> {
    const settings = await this.getSettings();

    // `smtpPass` vacío/no provisto significa "no tocar la contraseña actual"
    // — mismo guard que CompanyService.update() ya aplica a dgiiCertPassword,
    // necesario porque el GET enmascara este campo (ver controller), así que
    // el formulario nunca tiene el valor real para hacer round-trip.
    const patch: Partial<UpdateMailSettingsDto> = { ...dto };
    if (!patch.smtpPass) {
      delete patch.smtpPass;
    }

    Object.assign(settings, patch);

    if (settings.enabled && (!settings.smtpHost || !settings.smtpUser || !settings.fromAddress)) {
      throw new BadRequestException(
        'Para habilitar el SMTP propio, el host, el usuario y el remitente son requeridos.',
      );
    }

    return this.settingsRepository.save(settings);
  }
}
