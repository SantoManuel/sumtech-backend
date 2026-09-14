import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BillingSettingsService } from './billing-settings.service';
import { BillingSettingsEntity } from './entities/billing-settings.entity';

describe('BillingSettingsService', () => {
  let service: BillingSettingsService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      create: jest.fn((dto) => ({
        graceDaysBeforeSuspension: 5,
        reminderDaysAfterDue: 2,
        advanceReminderDaysBeforeDue: 3,
        ...dto,
      })),
      save: jest.fn((entity) => Promise.resolve({ id: 'settings-1', ...entity })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingSettingsService,
        { provide: getRepositoryToken(BillingSettingsEntity), useValue: repo },
      ],
    }).compile();

    service = module.get<BillingSettingsService>(BillingSettingsService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('devuelve la fila existente si ya hay una configuración guardada', async () => {
    repo.find.mockResolvedValue([{ id: 'settings-1', graceDaysBeforeSuspension: 7 }]);

    const settings = await service.getSettings();

    expect(settings).toEqual({ id: 'settings-1', graceDaysBeforeSuspension: 7 });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('crea una fila con los valores por defecto si no existe ninguna configuración', async () => {
    repo.find.mockResolvedValue([]);

    const settings = await service.getSettings();

    expect(repo.save).toHaveBeenCalled();
    expect(settings.graceDaysBeforeSuspension).toBe(5);
    expect(settings.reminderDaysAfterDue).toBe(2);
    expect(settings.advanceReminderDaysBeforeDue).toBe(3);
  });

  it('actualiza solo los campos provistos, preservando el resto', async () => {
    repo.find.mockResolvedValue([
      { id: 'settings-1', graceDaysBeforeSuspension: 5, reminderDaysAfterDue: 2, advanceReminderDaysBeforeDue: 3 },
    ]);

    const updated = await service.updateSettings({ graceDaysBeforeSuspension: 10 });

    expect(updated.graceDaysBeforeSuspension).toBe(10);
    expect(updated.reminderDaysAfterDue).toBe(2);
    expect(updated.advanceReminderDaysBeforeDue).toBe(3);
  });
});
