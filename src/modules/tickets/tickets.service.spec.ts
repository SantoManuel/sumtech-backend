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
});
