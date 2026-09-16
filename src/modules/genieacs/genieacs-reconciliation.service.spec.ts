import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GenieAcsReconciliationService } from './genieacs-reconciliation.service';
import { GenieAcsDeviceEntity } from './entities/genieacs-device.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { TicketsService } from '../tickets/tickets.service';
import { GENIEACS_CLIENT } from './genieacs-client-factory';

describe('GenieAcsReconciliationService', () => {
  let service: GenieAcsReconciliationService;
  let deviceRepo: any;
  let ticketRepo: any;
  let contractRepo: any;
  let ticketsService: any;
  let client: any;

  const makeDevice = (overrides: Partial<GenieAcsDeviceEntity> = {}): GenieAcsDeviceEntity =>
    ({
      id: 'device-1',
      contractId: 'contract-1',
      genieacsDeviceId: '00259E-ONT-16',
      opticalRxPowerDbm: -18,
      onlineStatus: 'UNKNOWN',
      ...overrides,
    }) as GenieAcsDeviceEntity;

  beforeEach(async () => {
    deviceRepo = { find: jest.fn().mockResolvedValue([]), save: jest.fn((entity: any) => Promise.resolve(entity)) };
    ticketRepo = { findOne: jest.fn().mockResolvedValue(null) };
    contractRepo = { findOneBy: jest.fn().mockResolvedValue({ id: 'contract-1', clientId: 'client-1' }) };
    ticketsService = { create: jest.fn().mockResolvedValue({ id: 'ticket-1' }) };
    client = { getDeviceStatus: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenieAcsReconciliationService,
        { provide: getRepositoryToken(GenieAcsDeviceEntity), useValue: deviceRepo },
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: TicketsService, useValue: ticketsService },
        { provide: GENIEACS_CLIENT, useValue: client },
      ],
    }).compile();

    service = module.get<GenieAcsReconciliationService>(GenieAcsReconciliationService);
  });

  describe('reconcileAll', () => {
    it('no hace nada (todo en 0) si GenieACS no está configurado', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GenieAcsReconciliationService,
          { provide: getRepositoryToken(GenieAcsDeviceEntity), useValue: deviceRepo },
          { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
          { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
          { provide: TicketsService, useValue: ticketsService },
          { provide: GENIEACS_CLIENT, useValue: null },
        ],
      }).compile();
      const unconfigured = module.get<GenieAcsReconciliationService>(GenieAcsReconciliationService);

      const result = await unconfigured.reconcileAll();

      expect(result).toEqual({ checked: 0, updated: 0, alertsCreated: 0, failed: 0 });
      expect(deviceRepo.find).not.toHaveBeenCalled();
    });

    it('no hace nada si no hay ningún equipo vinculado', async () => {
      deviceRepo.find.mockResolvedValue([]);

      const result = await service.reconcileAll();

      expect(result).toEqual({ checked: 0, updated: 0, alertsCreated: 0, failed: 0 });
    });

    it('actualiza el caché de cada equipo (ssid, potencia óptica, onlineStatus)', async () => {
      deviceRepo.find.mockResolvedValue([makeDevice()]);
      client.getDeviceStatus.mockResolvedValue({ ssid: 'MiRed', opticalRxPowerDbm: -19, lastInformAt: new Date() });

      const result = await service.reconcileAll();

      expect(result.checked).toBe(1);
      expect(result.updated).toBe(1);
      expect(deviceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ ssid: 'MiRed', opticalRxPowerDbm: -19, onlineStatus: 'ONLINE' }),
      );
    });

    it('crea un ticket de alerta cuando la potencia óptica CRUZA a crítica (transición)', async () => {
      deviceRepo.find.mockResolvedValue([makeDevice({ opticalRxPowerDbm: -20 })]); // antes: sana
      client.getDeviceStatus.mockResolvedValue({ opticalRxPowerDbm: -30, lastInformAt: new Date() }); // ahora: crítica

      const result = await service.reconcileAll();

      expect(result.alertsCreated).toBe(1);
      expect(ticketsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-1',
          contractId: 'contract-1',
          type: 'REPAIR_FAULT',
          priority: 'HIGH',
          title: '[Alerta GenieACS] Potencia óptica degradada',
        }),
      );
    });

    it('NO crea un segundo ticket si la potencia sigue crítica en ciclos sucesivos', async () => {
      deviceRepo.find.mockResolvedValue([makeDevice({ opticalRxPowerDbm: -30 })]); // ya estaba crítica
      client.getDeviceStatus.mockResolvedValue({ opticalRxPowerDbm: -31, lastInformAt: new Date() }); // sigue crítica

      const result = await service.reconcileAll();

      expect(result.alertsCreated).toBe(0);
      expect(ticketsService.create).not.toHaveBeenCalled();
    });

    it('NO crea un ticket duplicado si ya hay una alerta abierta para ese contrato', async () => {
      deviceRepo.find.mockResolvedValue([makeDevice({ opticalRxPowerDbm: -20 })]);
      client.getDeviceStatus.mockResolvedValue({ opticalRxPowerDbm: -30, lastInformAt: new Date() });
      ticketRepo.findOne.mockResolvedValue({ id: 'ticket-existente' });

      const result = await service.reconcileAll();

      expect(result.alertsCreated).toBe(0);
      expect(ticketsService.create).not.toHaveBeenCalled();
    });

    it('no crea ticket si el contrato del equipo ya no existe', async () => {
      deviceRepo.find.mockResolvedValue([makeDevice({ opticalRxPowerDbm: -20 })]);
      client.getDeviceStatus.mockResolvedValue({ opticalRxPowerDbm: -30, lastInformAt: new Date() });
      contractRepo.findOneBy.mockResolvedValue(null);

      const result = await service.reconcileAll();

      expect(result.alertsCreated).toBe(0);
      expect(ticketsService.create).not.toHaveBeenCalled();
    });

    it('un fallo en un equipo no aborta la reconciliación de los demás', async () => {
      deviceRepo.find.mockResolvedValue([
        makeDevice({ id: 'device-1', contractId: 'contract-1', genieacsDeviceId: 'dev-1' }),
        makeDevice({ id: 'device-2', contractId: 'contract-2', genieacsDeviceId: 'dev-2' }),
      ]);
      client.getDeviceStatus
        .mockRejectedValueOnce(new Error('timeout de GenieACS'))
        .mockResolvedValueOnce({ opticalRxPowerDbm: -18, lastInformAt: new Date() });

      const result = await service.reconcileAll();

      expect(result.checked).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.updated).toBe(1);
    });
  });
});
