import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingSettingsEntity } from './entities/billing-settings.entity';
import { UpdateBillingSettingsDto } from './dto/update-billing-settings.dto';

/**
 * Configuración global (fila única) del motor de morosidad. La migración 020 ya
 * siembra la fila por defecto, pero getSettings() la crea de forma perezosa si,
 * por alguna razón, no existiera (entorno recién provisionado, fila borrada, etc.).
 */
@Injectable()
export class BillingSettingsService {
  constructor(
    @InjectRepository(BillingSettingsEntity)
    private readonly settingsRepository: Repository<BillingSettingsEntity>,
  ) {}

  async getSettings(): Promise<BillingSettingsEntity> {
    const [existing] = await this.settingsRepository.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });
    if (existing) {
      return existing;
    }
    return this.settingsRepository.save(this.settingsRepository.create({}));
  }

  async updateSettings(dto: UpdateBillingSettingsDto): Promise<BillingSettingsEntity> {
    const settings = await this.getSettings();
    Object.assign(settings, dto);
    return this.settingsRepository.save(settings);
  }
}
