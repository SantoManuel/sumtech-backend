import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TicketsService } from './tickets.service';
import { TicketEntity } from './entities/ticket.entity';
import { TicketHistoryEntity } from './entities/ticket-history.entity';
import { TicketRepairEntity } from './entities/ticket-repair.entity';
import { SlaPolicyEntity } from './entities/sla-policy.entity';
import { AddressEntity } from '../clients/entities/address.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { EquipmentMovementService } from '../inventory/services/equipment-movement.service';

describe('TicketsService — geolocalización obligatoria al resolver instalación', () => {
  let service: TicketsService;
  let ticketRepo: any;
  let historyRepo: any;
  let addressRepo: any;
  let slaRepo: any;
  let eventEmitter: any;

  const baseTicket = (overrides: Partial<TicketEntity> = {}): any => ({
    id: 'ticket-1',
    clientId: 'client-1',
    contractId: 'contract-1',
    type: 'INSTALLATION',
    status: 'IN_PROGRESS',
    contract: { id: 'contract-1', address: { id: 'addr-1', gpsLatitude: null, gpsLongitude: null } },
    ...overrides,
  });

  beforeEach(async () => {
    ticketRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'ticket-generated', ticketNumber: 'TCK-000001', ...entity })),
    };
    historyRepo = {
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
    };
    addressRepo = {
      save: jest.fn((entity: any) => Promise.resolve(entity)),
    };
    slaRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(TicketHistoryEntity), useValue: historyRepo },
        { provide: getRepositoryToken(TicketRepairEntity), useValue: {} },
        { provide: getRepositoryToken(SlaPolicyEntity), useValue: slaRepo },
        { provide: getRepositoryToken(AddressEntity), useValue: addressRepo },
        {
          provide: getRepositoryToken(ContractEntity),
          useValue: {
            findOne: jest.fn(),
            findOneBy: jest.fn().mockResolvedValue({ id: 'contract-1', clientId: 'client-1' }),
            save: jest.fn(),
          },
        },
        { provide: EquipmentMovementService, useValue: {} },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<TicketsService>(TicketsService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('createInstallationFromContract', () => {
    it('crea un ticket INSTALLATION de prioridad HIGH con el contractId enlazado', async () => {
      const ticket = await service.createInstallationFromContract('client-1', 'contract-1', 'CTR-000123');

      expect(ticket.type).toBe('INSTALLATION');
      expect(ticket.priority).toBe('HIGH');
      expect(ticket.clientId).toBe('client-1');
      expect(ticket.contractId).toBe('contract-1');
      expect(ticket.title).toContain('CTR-000123');
      expect(ticket.status).toBe('OPEN');
    });
  });

  it('rechaza RESOLVED de una instalación sin coordenadas GPS', async () => {
    ticketRepo.findOne.mockResolvedValue(baseTicket());

    await expect(service.updateStatus('ticket-1', 'user-1', { status: 'RESOLVED' })).rejects.toThrow(
      BadRequestException,
    );
    expect(addressRepo.save).not.toHaveBeenCalled();
  });

  it('persiste las coordenadas en contract.address cuando se resuelve una instalación con GPS', async () => {
    ticketRepo.findOne.mockResolvedValue(baseTicket());

    await service.updateStatus('ticket-1', 'user-1', {
      status: 'RESOLVED',
      latitude: 18.4861,
      longitude: -69.9312,
    });

    expect(addressRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ gpsLatitude: 18.4861, gpsLongitude: -69.9312 }),
    );
  });

  it('no exige coordenadas para resolver un ticket de reparación/mantenimiento', async () => {
    ticketRepo.findOne.mockResolvedValue(baseTicket({ type: 'REPAIR_FAULT' }));

    await expect(
      service.updateStatus('ticket-1', 'user-1', { status: 'RESOLVED' }),
    ).resolves.toBeDefined();
    expect(addressRepo.save).not.toHaveBeenCalled();
  });

  it('rechaza la resolución si la instalación no tiene contrato/dirección asociada', async () => {
    ticketRepo.findOne.mockResolvedValue(baseTicket({ contract: null as any }));

    await expect(
      service.updateStatus('ticket-1', 'user-1', { status: 'RESOLVED', latitude: 1, longitude: 1 }),
    ).rejects.toThrow(BadRequestException);
  });

  describe('pivotSchedule', () => {
    // Regresión: la condición original usaba "ticket.scheduledStart::date =
    // :sourceDate" — TypeORM no traduce alias.propiedad -> columna real
    // cuando el cast "::date" queda pegado sin espacio, así que Postgres
    // recibía el identificador sin comillas ("scheduledstart", minúsculas) y
    // fallaba con "column ticket.scheduledstart does not exist" (500 real,
    // reproducido contra la BD — un mock nunca lo habría detectado). El
    // fix envuelve la columna en DATE(...) en vez del sufijo "::date".
    let queryBuilder: any;

    const pivotTicket = (overrides: Partial<TicketEntity> = {}): any => ({
      id: 'ticket-1',
      status: 'OPEN',
      scheduledStart: new Date('2026-09-15T16:59:00.000Z'),
      assignedEmployeeId: 'tech-1',
      ...overrides,
    });

    beforeEach(() => {
      queryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      ticketRepo.createQueryBuilder = jest.fn().mockReturnValue(queryBuilder);
    });

    it('usa DATE(ticket.scheduledStart) en vez de "::date" al filtrar por fecha origen', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await service.pivotSchedule({ sourceDate: '2026-09-15', targetDate: '2026-09-20' } as any, 'user-1');

      expect(queryBuilder.where).toHaveBeenCalledWith('DATE(ticket.scheduledStart) = :sourceDate', {
        sourceDate: '2026-09-15',
      });
    });

    it('filtra por ticketIds en vez de sourceDate cuando se proveen', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await service.pivotSchedule(
        { ticketIds: ['ticket-1'], sourceDate: '2026-09-15', targetDate: '2026-09-20' } as any,
        'user-1',
      );

      expect(queryBuilder.where).toHaveBeenCalledWith('ticket.id IN (:...ticketIds)', { ticketIds: ['ticket-1'] });
    });

    it('agrega el filtro de técnicos con andWhere cuando se proveen technicianIds', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await service.pivotSchedule(
        { sourceDate: '2026-09-15', targetDate: '2026-09-20', technicianIds: ['tech-1'] } as any,
        'user-1',
      );

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('ticket.assignedEmployeeId IN (:...technicianIds)', {
        technicianIds: ['tech-1'],
      });
    });

    it('mueve los tickets encontrados a la fecha destino preservando la hora original y registra el historial', async () => {
      const ticket = pivotTicket();
      queryBuilder.getMany.mockResolvedValue([ticket]);
      ticketRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

      const result = await service.pivotSchedule(
        { sourceDate: '2026-09-15', targetDate: '2026-09-20', reason: 'Ajuste de agenda' } as any,
        'user-1',
      );

      expect(result.count).toBe(1);
      // El servicio construye la fecha destino con componentes locales
      // (new Date(year, month-1, day, hours, minutes)) — se comparan
      // getters locales, no UTC, para no depender de la zona horaria de
      // quien ejecute la prueba.
      expect(ticket.scheduledStart.getFullYear()).toBe(2026);
      expect(ticket.scheduledStart.getMonth()).toBe(8); // Septiembre (0-index)
      expect(ticket.scheduledStart.getDate()).toBe(20);
      expect(historyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: 'ticket-1',
          note: expect.stringContaining('GANTT PIVOT'),
        }),
      );
    });

    it('no mueve nada ni escribe historial si no hay tickets para la fecha origen', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      const result = await service.pivotSchedule(
        { sourceDate: '2026-09-15', targetDate: '2026-09-20' } as any,
        'user-1',
      );

      expect(result).toEqual({ count: 0, movedTickets: [] });
      expect(ticketRepo.save).not.toHaveBeenCalled();
      expect(historyRepo.save).not.toHaveBeenCalled();
    });
  });
});
