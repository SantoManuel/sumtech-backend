import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GenieAcsReconciliationService } from './genieacs-reconciliation.service';
import { GenieAcsDeviceEntity } from './entities/genieacs-device.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { TicketsService } from '../tickets/tickets.service';
import { GENIEACS_CLIENT } from './genieacs-client-factory';
import { TenantIteratorService } from '../../common/tenancy/tenant-iterator.service';
import { OnuEntity } from '../olt/entities/onu.entity';

const tenantIteratorMock = {
  runForEachActiveTenant: jest.fn((_label: string, fn: (t: any) => Promise<void>) => fn({ slug: 'tenant-test' })),
};

describe('GenieAcsReconciliationService', () => {
  let service: GenieAcsReconciliationService;
  let deviceRepo: any;
  let ticketRepo: any;
  let contractRepo: any;
  let onuRepo: any;
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
    onuRepo = { find: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue(undefined) };
    ticketsService = { create: jest.fn().mockResolvedValue({ id: 'ticket-1' }) };
    client = { getDeviceStatus: jest.fn(), findDeviceBySerial: jest.fn(), setDeviceTag: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenieAcsReconciliationService,
        { provide: getRepositoryToken(GenieAcsDeviceEntity), useValue: deviceRepo },
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: getRepositoryToken(OnuEntity), useValue: onuRepo },
        { provide: TicketsService, useValue: ticketsService },
        { provide: GENIEACS_CLIENT, useValue: client },
        { provide: TenantIteratorService, useValue: tenantIteratorMock },
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
          { provide: getRepositoryToken(OnuEntity), useValue: onuRepo },
          { provide: TicketsService, useValue: ticketsService },
          { provide: GENIEACS_CLIENT, useValue: null },
          { provide: TenantIteratorService, useValue: tenantIteratorMock },
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

  // Etiquetado tenant/OLT en GenieACS -- ver docs/onu-tr069-provisioning-zte-c320.md.
  // GenieACS es una sola instancia compartida por todos los tenants, así que
  // sin esto no hay forma de saber a qué ISP/OLT pertenece un dispositivo.
  describe('reconcileOnuTags (corre dentro de handleReconciliation, por tenant)', () => {
    const makeOnu = (overrides: Partial<OnuEntity> = {}): OnuEntity =>
      ({
        id: 'onu-1',
        serialNumber: 'CMDCDD4D131E',
        status: 'ACTIVE',
        genieacsDeviceId: null,
        olt: { name: 'OLT_Tabara_Abajo' },
        serviceConfig: { managementMethod: 'TR069' },
        ...overrides,
      }) as unknown as OnuEntity;

    it('resuelve y persiste genieacsDeviceId si todavía no estaba, y etiqueta tenant+olt', async () => {
      onuRepo.find.mockResolvedValue([makeOnu()]);
      client.findDeviceBySerial.mockResolvedValue('00259E-ONT-16');
      client.getDeviceStatus.mockResolvedValue({ tags: [] });

      await service.handleReconciliation();

      expect(client.findDeviceBySerial).toHaveBeenCalledWith('CMDCDD4D131E');
      expect(onuRepo.update).toHaveBeenCalledWith('onu-1', { genieacsDeviceId: '00259E-ONT-16' });
      expect(client.setDeviceTag).toHaveBeenCalledWith('00259E-ONT-16', 'tenant:tenant-test');
      expect(client.setDeviceTag).toHaveBeenCalledWith('00259E-ONT-16', 'olt:OLT_Tabara_Abajo');
    });

    it('si el ONU aún no apareció en GenieACS (findDeviceBySerial devuelve null), no intenta etiquetar nada', async () => {
      onuRepo.find.mockResolvedValue([makeOnu()]);
      client.findDeviceBySerial.mockResolvedValue(null);

      await service.handleReconciliation();

      expect(onuRepo.update).not.toHaveBeenCalled();
      expect(client.setDeviceTag).not.toHaveBeenCalled();
    });

    it('si ya tiene genieacsDeviceId, no vuelve a buscarlo por serial -- solo verifica/completa los tags', async () => {
      onuRepo.find.mockResolvedValue([makeOnu({ genieacsDeviceId: '00259E-ONT-16' })]);
      client.getDeviceStatus.mockResolvedValue({ tags: ['tenant:tenant-test'] });

      await service.handleReconciliation();

      expect(client.findDeviceBySerial).not.toHaveBeenCalled();
      // Ya tenía "tenant:tenant-test" -- solo falta "olt:...", es idempotente.
      expect(client.setDeviceTag).toHaveBeenCalledTimes(1);
      expect(client.setDeviceTag).toHaveBeenCalledWith('00259E-ONT-16', 'olt:OLT_Tabara_Abajo');
    });

    it('si ya tiene AMBOS tags, no llama a setDeviceTag en absoluto (idempotente, no gasta llamadas de más a la NBI)', async () => {
      onuRepo.find.mockResolvedValue([makeOnu({ genieacsDeviceId: '00259E-ONT-16' })]);
      client.getDeviceStatus.mockResolvedValue({ tags: ['tenant:tenant-test', 'olt:OLT_Tabara_Abajo'] });

      await service.handleReconciliation();

      expect(client.setDeviceTag).not.toHaveBeenCalled();
    });

    it('ignora ONUs con managementMethod OMCI -- nunca van a reportar a GenieACS', async () => {
      onuRepo.find.mockResolvedValue([makeOnu({ serviceConfig: { managementMethod: 'OMCI' } as any })]);

      await service.handleReconciliation();

      expect(client.findDeviceBySerial).not.toHaveBeenCalled();
      expect(client.getDeviceStatus).not.toHaveBeenCalled();
    });

    it('un fallo etiquetando una ONU no aborta el resto del ciclo', async () => {
      onuRepo.find.mockResolvedValue([
        makeOnu({ id: 'onu-1', serialNumber: 'SERIAL-1', genieacsDeviceId: 'dev-1' }),
        makeOnu({ id: 'onu-2', serialNumber: 'SERIAL-2', genieacsDeviceId: 'dev-2' }),
      ]);
      client.getDeviceStatus
        .mockRejectedValueOnce(new Error('timeout de GenieACS'))
        .mockResolvedValueOnce({ tags: [] });

      await service.handleReconciliation();

      expect(client.setDeviceTag).toHaveBeenCalledWith('dev-2', 'tenant:tenant-test');
      expect(client.setDeviceTag).toHaveBeenCalledWith('dev-2', 'olt:OLT_Tabara_Abajo');
    });

    it('no hace nada si GenieACS no está configurado (cliente null)', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GenieAcsReconciliationService,
          { provide: getRepositoryToken(GenieAcsDeviceEntity), useValue: deviceRepo },
          { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
          { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
          { provide: getRepositoryToken(OnuEntity), useValue: onuRepo },
          { provide: TicketsService, useValue: ticketsService },
          { provide: GENIEACS_CLIENT, useValue: null },
          { provide: TenantIteratorService, useValue: tenantIteratorMock },
        ],
      }).compile();
      const unconfigured = module.get<GenieAcsReconciliationService>(GenieAcsReconciliationService);

      await unconfigured.handleReconciliation();

      expect(onuRepo.find).not.toHaveBeenCalled();
    });
  });
});
