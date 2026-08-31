import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ScheduleEventsService } from './schedule-events.service';
import { ScheduleEventEntity } from './entities/schedule-event.entity';
import { CreateScheduleEventDto, UpdateScheduleEventDto, FilterScheduleEventsDto } from './dto/schedule-event.dto';

describe('ScheduleEventsService', () => {
  let service: ScheduleEventsService;
  let repo: jest.Mocked<Repository<ScheduleEventEntity>>;

  const mockQueryBuilder: any = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
    getOne: jest.fn(),
  };

  const mockRepository = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  const sampleEvent: ScheduleEventEntity = {
    id: 'a0000000-0000-0000-0000-000000000001',
    title: 'Cierre de Facturación Mensual',
    description: 'Generación masiva de comprobantes e-CF',
    type: 'FECHA_PAGO',
    scope: 'GLOBAL',
    eventDate: '2026-08-30',
    durationMinutes: 600,
    isAllDay: true,
    color: 'amber',
    createdByUserId: 'u0000000-0000-0000-0000-000000000001',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduleEventsService,
        {
          provide: getRepositoryToken(ScheduleEventEntity),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<ScheduleEventsService>(ScheduleEventsService);
    repo = module.get(getRepositoryToken(ScheduleEventEntity));
    jest.clearAllMocks();
  });

  it('debe estar definido correctamente', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('debe retornar lista de eventos aplicando filtros de fecha y tipo', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([sampleEvent]);

      const filter: FilterScheduleEventsDto = {
        startDate: '2026-08-25',
        endDate: '2026-08-31',
        type: 'FECHA_PAGO',
      };

      const result = await service.findAll(filter);

      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('event');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'event.eventDate BETWEEN :startDate AND :endDate',
        { startDate: '2026-08-25', endDate: '2026-08-31' }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'event.type = :type',
        { type: 'FECHA_PAGO' }
      );
      expect(result).toEqual([sampleEvent]);
    });

    it('debe filtrar eventos asignados a un técnico o de alcance global', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([sampleEvent]);

      const filter: FilterScheduleEventsDto = {
        assignedEmployeeId: 'e0000000-0000-0000-0000-000000000001',
      };

      const result = await service.findAll(filter);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(event.assignedEmployeeId = :employeeId OR event.scope = :globalScope)',
        { employeeId: 'e0000000-0000-0000-0000-000000000001', globalScope: 'GLOBAL' }
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('debe retornar el evento si existe en base de datos', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(sampleEvent);

      const result = await service.findById(sampleEvent.id);
      expect(result).toEqual(sampleEvent);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('event.id = :id', { id: sampleEvent.id });
    });

    it('debe lanzar NotFoundException si el evento no existe', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);

      await expect(service.findById('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('debe crear exitosamente un evento global de todo el día', async () => {
      const dto: CreateScheduleEventDto = {
        title: 'Reunión General de Operaciones',
        description: 'Alineación de objetivos semanales',
        type: 'REUNION',
        scope: 'GLOBAL',
        eventDate: '2026-09-01',
        isAllDay: true,
      };

      const createdObj = { ...sampleEvent, ...dto, id: 'new-id' };
      mockRepository.create.mockReturnValue(createdObj as any);
      mockRepository.save.mockResolvedValue(createdObj as any);
      mockQueryBuilder.getOne.mockResolvedValue(createdObj as any);

      const result = await service.create('u-creator-id', dto);

      expect(mockRepository.create).toHaveBeenCalled();
      expect(mockRepository.save).toHaveBeenCalled();
      expect(result.title).toBe(dto.title);
    });

    it('debe lanzar BadRequestException si el alcance es EMPLOYEE pero no se especifica assignedEmployeeId', async () => {
      const dto: CreateScheduleEventDto = {
        title: 'Capacitación Fibra Óptica',
        type: 'CAPACITACION',
        scope: 'EMPLOYEE',
        eventDate: '2026-09-01',
        // assignedEmployeeId omitted
      };

      await expect(service.create('u-creator-id', dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('debe actualizar los campos proporcionados de un evento existente', async () => {
      mockQueryBuilder.getOne.mockResolvedValue({ ...sampleEvent });
      mockRepository.save.mockResolvedValue({ ...sampleEvent, title: 'Título Actualizado' } as any);

      const updateDto: UpdateScheduleEventDto = {
        title: 'Título Actualizado',
        durationMinutes: 90,
      };

      const result = await service.update(sampleEvent.id, updateDto);

      expect(mockRepository.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('delete', () => {
    it('debe eliminar el evento y retornar confirmación', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(sampleEvent);
      mockRepository.remove.mockResolvedValue(sampleEvent);

      const result = await service.delete(sampleEvent.id);

      expect(mockRepository.remove).toHaveBeenCalledWith(sampleEvent);
      expect(result.success).toBe(true);
    });
  });
});
