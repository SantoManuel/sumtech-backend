import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DailyClosuresService } from './daily-closures.service';
import { DailyClosureEntity } from './entities/daily-closure.entity';
import { DailyClosureExpenseEntity } from './entities/daily-closure-expense.entity';
import { MinioStorageService } from '../storage/minio-storage.service';

describe('DailyClosuresService', () => {
  let service: DailyClosuresService;
  let closureRepo: any;
  let expenseRepo: any;
  let storageService: any;

  const file = (name: string): Express.Multer.File =>
    ({ originalname: name, buffer: Buffer.from('foto'), size: 4 } as Express.Multer.File);

  beforeEach(async () => {
    closureRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'closure-1', ...entity })),
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      })),
    };
    expenseRepo = {
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
    };
    storageService = {
      uploadBuffer: jest.fn().mockResolvedValue('daily-closures/2026-09-07/foto.jpg'),
      getPresignedUrl: jest.fn().mockResolvedValue('https://minio.local/presigned'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailyClosuresService,
        { provide: getRepositoryToken(DailyClosureEntity), useValue: closureRepo },
        { provide: getRepositoryToken(DailyClosureExpenseEntity), useValue: expenseRepo },
        { provide: MinioStorageService, useValue: storageService },
      ],
    }).compile();

    service = module.get<DailyClosuresService>(DailyClosuresService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('startJornada', () => {
    it('crea la jornada del día con startedAt y las coordenadas GPS iniciales', async () => {
      closureRepo.findOne.mockResolvedValue(null);

      const jornada = await service.startJornada('emp-1', { latitude: 18.48, longitude: -69.93 });

      expect(closureRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ employeeId: 'emp-1', startLatitude: 18.48, startLongitude: -69.93 }),
      );
      expect(jornada.startedAt).toBeDefined();
    });

    it('rechaza si ya tiene una jornada en curso sin cerrar (409)', async () => {
      closureRepo.findOne.mockResolvedValue({ id: 'closure-existing', closedAt: null });

      await expect(service.startJornada('emp-1', {})).rejects.toThrow(ConflictException);
    });

    it('permite iniciar una nueva jornada si la anterior ya fue cerrada', async () => {
      closureRepo.findOne.mockResolvedValue(null);

      const jornada = await service.startJornada('emp-1', { latitude: 18.48, longitude: -69.93 });

      expect(closureRepo.save).toHaveBeenCalled();
      expect(jornada.startedAt).toBeDefined();
    });
  });

  describe('getTodayStatus', () => {
    it('retorna NOT_STARTED si no existe ninguna jornada hoy', async () => {
      closureRepo.findOne.mockResolvedValue(null);

      const status = await service.getTodayStatus('emp-1');

      expect(status).toEqual({ status: 'NOT_STARTED' });
    });

    it('retorna IN_PROGRESS si la jornada está iniciada pero no cerrada', async () => {
      closureRepo.findOne.mockResolvedValue({ id: 'closure-1', startedAt: new Date('2026-09-07T08:00:00Z'), closedAt: null });

      const status = await service.getTodayStatus('emp-1');

      expect(status.status).toBe('IN_PROGRESS');
    });

    it('retorna CLOSED con canStartNew si ya cerró una jornada hoy', async () => {
      // 1ra llamada: busca activa (retorna null)
      // 2da llamada: busca cerrada hoy (retorna closure)
      closureRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'closure-1',
          startedAt: new Date('2026-09-07T08:00:00Z'),
          closedAt: new Date('2026-09-07T18:00:00Z'),
          fuelAmount: 800,
          totalExpensesAmount: 150,
        });

      const status: any = await service.getTodayStatus('emp-1');

      expect(status.status).toBe('CLOSED');
      expect(status.fuelAmount).toBe(800);
      expect(status.canStartNew).toBe(true);
    });
  });

  describe('close', () => {
    it('rechaza si el técnico no tiene una jornada abierta para cerrar', async () => {
      closureRepo.findOne.mockResolvedValue(null);

      await expect(
        service.close('emp-1', { fuelAmount: 500, expenses: '[]' }, '[]', [file('a.jpg')], file('fuel.jpg')),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si no se adjunta la foto de factura de combustible', async () => {
      closureRepo.findOne.mockResolvedValue({ id: 'closure-1', closedAt: null });

      await expect(
        service.close('emp-1', { fuelAmount: 500, expenses: '[]' }, '[]', [file('a.jpg')], undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si no viene el JSON de gastos', async () => {
      closureRepo.findOne.mockResolvedValue({ id: 'closure-1', closedAt: null });

      await expect(
        service.close('emp-1', { fuelAmount: 500 } as any, undefined, [file('a.jpg')], file('fuel.jpg')),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza si la cantidad de fotos no coincide con la cantidad de líneas de gasto', async () => {
      closureRepo.findOne.mockResolvedValue({ id: 'closure-1', closedAt: null });
      const expensesRaw = JSON.stringify([{ concept: 'Peaje', amount: 100 }]);

      await expect(
        service.close('emp-1', { fuelAmount: 500, expenses: expensesRaw }, expensesRaw, [], file('fuel.jpg')),
      ).rejects.toThrow(BadRequestException);
    });

    it('cierra la jornada abierta, calcula totalExpensesAmount y sube cada foto', async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());
      closureRepo.findOne
        .mockResolvedValueOnce({ id: 'closure-1', employeeId: 'emp-1', closureDate: today, closedAt: null }) // jornada abierta
        .mockResolvedValue({
          id: 'closure-1',
          employeeId: 'emp-1',
          fuelAmount: 500,
          totalExpensesAmount: 150,
          expenses: [],
        }); // findById al final
      const expensesRaw = JSON.stringify([
        { concept: 'Peaje', amount: 100 },
        { concept: 'Reparación menor', amount: 50 },
      ]);

      await service.close(
        'emp-1',
        { fuelAmount: 500, expenses: expensesRaw },
        expensesRaw,
        [file('peaje.jpg'), file('reparacion.jpg')],
        file('combustible.jpg'),
      );

      expect(closureRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'closure-1', fuelAmount: 500, totalExpensesAmount: 150, closedAt: expect.any(Date) }),
      );
      expect(storageService.uploadBuffer).toHaveBeenCalledTimes(3);
      expect(storageService.uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'combustible.jpg', `daily-closures/${today}`);
      expect(storageService.uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'peaje.jpg', `daily-closures/${today}`);
      expect(expenseRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ concept: 'Peaje', amount: 100, receiptPhotoKey: 'daily-closures/2026-09-07/foto.jpg' }),
      );
    });
  });

  describe('getDetailWithSignedUrls', () => {
    it('lanza NotFoundException si el cierre no existe', async () => {
      closureRepo.findOne.mockResolvedValue(null);

      await expect(service.getDetailWithSignedUrls('closure-x')).rejects.toThrow(NotFoundException);
    });

    it('genera una URL firmada por cada gasto y calcula el total del día', async () => {
      closureRepo.findOne.mockResolvedValue({
        id: 'closure-1',
        employeeId: 'emp-1',
        employee: { user: { username: 'juan.tecnico' } },
        closureDate: '2026-09-07',
        startedAt: new Date('2026-09-07T08:00:00Z'),
        closedAt: new Date('2026-09-07T18:00:00Z'),
        fuelAmount: 500,
        totalExpensesAmount: 150,
        notes: null,
        createdAt: new Date('2026-09-07'),
        expenses: [{ id: 'exp-1', concept: 'Peaje', amount: 100, receiptPhotoKey: 'daily-closures/2026-09-07/peaje.jpg' }],
      });

      const detail = await service.getDetailWithSignedUrls('closure-1');

      expect(detail.totalDayAmount).toBe(650);
      expect(detail.expenses[0].photoUrl).toBe('https://minio.local/presigned');
      expect(storageService.getPresignedUrl).toHaveBeenCalledWith('daily-closures/2026-09-07/peaje.jpg');
    });
  });

  describe('findAll', () => {
    it('aplica paginación por defecto (page=1, limit=15)', async () => {
      const result = await service.findAll({});

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 15, totalPages: 0 });
    });
  });
});
