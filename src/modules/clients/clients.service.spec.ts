import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClientsService } from './clients.service';
import { ClientEntity } from './entities/client.entity';
import { AddressEntity } from './entities/address.entity';
import { ContractEntity } from './entities/contract.entity';
import { UserEntity } from '../users/entities/user.entity';
import { RoleEntity } from '../users/entities/role.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { PlanEntity } from '../plans/entities/plan.entity';
import { SystemEvents } from '../../common/enums/system-events.enum';
import { PdfGeneratorService } from '../printing/pdf-generator.service';
import { DgiiClientService } from '../invoicing/dgii/dgii-client.service';
import { ContractSignaturesService } from '../contract-signatures/contract-signatures.service';
import { SectorEntity } from '../geography/entities/sector.entity';
import { AddressGpsRequestEntity } from './entities/address-gps-request.entity';
import { AiChatbotClientService } from '../ai-chatbot/ai-chatbot-client.service';

describe('ClientsService - contratos y facturas (Fase 5 backend)', () => {
  let service: ClientsService;
  let clientRepo: any;
  let contractRepo: any;
  let invoiceRepo: any;
  let planRepo: any;
  let eventEmitter: any;
  let pdfGenerator: any;
  let dgiiClient: any;
  let contractSignatures: any;

  let userRepo: any;
  let roleRepo: any;
  let sectorRepo: any;
  let gpsRequestRepo: any;
  let aiChatbotClient: any;

  beforeEach(async () => {
    const clientQueryBuilder: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    clientRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'client-1', name: 'Cliente Test' }),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: entity.id || 'client-generated', ...entity })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => clientQueryBuilder),
    };
    userRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'user-1', ...entity })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    roleRepo = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'role-cliente', name: 'CLIENTE' }),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'role-cliente', ...entity })),
      create: jest.fn((dto: any) => dto),
    };
    const contractQueryBuilder: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    contractRepo = {
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'contract-1', ...entity })),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => contractQueryBuilder),
    };
    invoiceRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    planRepo = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'plan-1', name: 'Fibra 100', isActive: true }),
    };
    eventEmitter = {
      emit: jest.fn(),
    };
    pdfGenerator = {
      generateContractPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
    };
    dgiiClient = {
      getConfig: jest.fn().mockReturnValue({
        rncEmisor: '131000000',
        razonSocialEmisor: 'SUMTECH TELECOM SRL',
        nombreComercial: 'SUMTECH FIBRA & TV',
        direccionEmisor: 'Av. Sumtech',
        telefonoEmisor: '809-555-0199',
        correoEmisor: 'facturacion@sumtech.com.do',
      }),
    };
    contractSignatures = {
      getLatestBufferForPdf: jest.fn().mockResolvedValue(null),
    };
    sectorRepo = {
      findOne: jest.fn(),
    };
    gpsRequestRepo = {
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'gps-request-1', ...entity })),
    };
    aiChatbotClient = {
      sendWhatsAppMessage: jest.fn().mockResolvedValue(true),
      getConversationByPhone: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: getRepositoryToken(ClientEntity), useValue: clientRepo },
        { provide: getRepositoryToken(AddressEntity), useValue: { create: jest.fn((dto: any) => dto) } },
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: getRepositoryToken(RoleEntity), useValue: roleRepo },
        { provide: getRepositoryToken(InvoiceEntity), useValue: invoiceRepo },
        { provide: getRepositoryToken(PlanEntity), useValue: planRepo },
        { provide: getRepositoryToken(SectorEntity), useValue: sectorRepo },
        { provide: getRepositoryToken(AddressGpsRequestEntity), useValue: gpsRequestRepo },
        { provide: AiChatbotClientService, useValue: aiChatbotClient },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: PdfGeneratorService, useValue: pdfGenerator },
        { provide: DgiiClientService, useValue: dgiiClient },
        { provide: ContractSignaturesService, useValue: contractSignatures },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('create (cliente)', () => {
    const baseDto = {
      clientType: 'FISICA' as const,
      name: 'Ana Pérez',
      docType: 'CEDULA' as const,
      docNumber: '001-2222222-2',
      email: 'ana@test.com',
      phone: '8095551111',
      address: { street: 'Calle 1', sector: 'Centro', municipality: 'Santo Domingo Este', city: 'Santo Domingo' },
    };

    it('crea el cliente y provee una cuenta digital con contraseña inicial de 6 caracteres', async () => {
      clientRepo.findOne.mockResolvedValueOnce(null);

      const result = await service.create(baseDto as any);

      expect(result.initialDigitalPassword).toHaveLength(6);
      expect(userRepo.save).toHaveBeenCalled();
      expect(clientRepo.save).toHaveBeenCalledTimes(2);
    });

    it('guarda la misma contraseña inicial en pendingPortalPassword (para que el PDF del contrato la muestre después)', async () => {
      clientRepo.findOne.mockResolvedValueOnce(null);

      const result = await service.create(baseDto as any);

      expect((result as any).pendingPortalPassword).toBe(result.initialDigitalPassword);
    });

    it('lanza ConflictException si ya existe un cliente con el mismo docNumber', async () => {
      clientRepo.findOne.mockResolvedValueOnce({ id: 'existing-client', docNumber: baseDto.docNumber });

      await expect(service.create(baseDto as any)).rejects.toThrow(ConflictException);
    });

    it('resuelve sectorId contra el módulo de geografía y sincroniza sector/municipality/city en texto', async () => {
      clientRepo.findOne.mockResolvedValueOnce(null);
      sectorRepo.findOne.mockResolvedValueOnce({
        id: 'sector-1',
        name: 'Piantini',
        municipalityId: 'muni-1',
        municipality: {
          id: 'muni-1',
          name: 'Santo Domingo de Guzmán',
          provinceId: 'prov-1',
          province: { id: 'prov-1', name: 'Distrito Nacional', countryId: 'country-1' },
        },
      });

      const dto = { ...baseDto, address: { street: 'Calle 1', sectorId: 'sector-1' } };
      const result = await service.create(dto as any);

      expect(sectorRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'sector-1' },
        relations: ['municipality', 'municipality.province', 'municipality.province.country'],
      });
      const savedAddress = (result as any).addresses[0];
      expect(savedAddress.sector).toBe('Piantini');
      expect(savedAddress.municipality).toBe('Santo Domingo de Guzmán');
      expect(savedAddress.city).toBe('Distrito Nacional');
      expect(savedAddress.countryId).toBe('country-1');
      expect(savedAddress.provinceId).toBe('prov-1');
      expect(savedAddress.municipalityId).toBe('muni-1');
    });

    it('lanza NotFoundException si el sectorId no existe en el módulo de geografía', async () => {
      clientRepo.findOne.mockResolvedValueOnce(null);
      sectorRepo.findOne.mockResolvedValueOnce(null);

      const dto = { ...baseDto, address: { street: 'Calle 1', sectorId: 'sector-inexistente' } };

      await expect(service.create(dto as any)).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si no se envía sectorId ni sector/municipality/city como texto', async () => {
      clientRepo.findOne.mockResolvedValueOnce(null);

      const dto = { ...baseDto, address: { street: 'Calle 1' } };

      await expect(service.create(dto as any)).rejects.toThrow(BadRequestException);
    });

    it('acepta sector/municipality/city como texto libre sin llamar al módulo de geografía (compatibilidad hacia atrás)', async () => {
      clientRepo.findOne.mockResolvedValueOnce(null);

      const result = await service.create(baseDto as any);

      expect(sectorRepo.findOne).not.toHaveBeenCalled();
      const savedAddress = (result as any).addresses[0];
      expect(savedAddress.sector).toBe('Centro');
    });
  });

  describe('resetDigitalPassword', () => {
    it('lanza ConflictException si el cliente no tiene cuenta digital', async () => {
      clientRepo.findOne.mockResolvedValueOnce({ id: 'client-1', name: 'Sin cuenta' });
      await expect(service.resetDigitalPassword('client-1')).rejects.toThrow(ConflictException);
    });

    it('actualiza el hash del usuario y guarda la nueva contraseña en pendingPortalPassword', async () => {
      clientRepo.findOne.mockResolvedValueOnce({ id: 'client-1', name: 'Ana Pérez', userId: 'user-1' });

      const result = await service.resetDigitalPassword('client-1');

      expect(result.initialDigitalPassword).toHaveLength(6);
      expect(userRepo.update).toHaveBeenCalledWith('user-1', { passwordHash: expect.any(String) });
      expect(clientRepo.update).toHaveBeenCalledWith('client-1', { pendingPortalPassword: result.initialDigitalPassword });
    });
  });

  describe('requestGpsLocation', () => {
    it('genera un token de 64 caracteres, lo guarda con expiración de 24h y devuelve el enlace', async () => {
      clientRepo.findOne.mockResolvedValueOnce({
        id: 'client-1',
        name: 'Ana Pérez',
        phone: '8095551111',
        addresses: [{ id: 'address-1' }],
      });

      const result = await service.requestGpsLocation('client-1', 'address-1', 'user-1');

      expect(result.token).toHaveLength(64);
      expect(result.link).toContain(result.token);
      expect(result.link).toContain('/ubicacion/');
      expect(result.whatsappSent).toBe(true);
      expect(gpsRequestRepo.save).toHaveBeenCalled();
      expect(aiChatbotClient.sendWhatsAppMessage).toHaveBeenCalledWith(
        '8095551111',
        expect.stringContaining(result.link),
      );
    });

    it('lanza NotFoundException si la dirección no pertenece al cliente', async () => {
      clientRepo.findOne.mockResolvedValueOnce({ id: 'client-1', addresses: [{ id: 'otra-direccion' }] });

      await expect(service.requestGpsLocation('client-1', 'address-inexistente')).rejects.toThrow(NotFoundException);
    });

    it('whatsappSent es false si el envío de WhatsApp falla, pero igual devuelve el enlace generado', async () => {
      clientRepo.findOne.mockResolvedValueOnce({
        id: 'client-1',
        name: 'Ana Pérez',
        phone: '8095551111',
        addresses: [{ id: 'address-1' }],
      });
      aiChatbotClient.sendWhatsAppMessage.mockResolvedValueOnce(false);

      const result = await service.requestGpsLocation('client-1', 'address-1');

      expect(result.whatsappSent).toBe(false);
      expect(result.link).toBeDefined();
      expect(gpsRequestRepo.save).toHaveBeenCalled();
    });
  });

  describe('update (cliente)', () => {
    it('actualiza name/email/docType/docNumber', async () => {
      clientRepo.findOne.mockResolvedValueOnce({
        id: 'client-1',
        name: 'Nombre Viejo',
        docType: 'CEDULA',
        docNumber: '001-0000000-0',
        email: 'viejo@test.com',
      });

      const result = await service.update('client-1', {
        name: 'Nombre Nuevo',
        email: 'nuevo@test.com',
        docType: 'RNC',
      } as any);

      expect(result.name).toBe('Nombre Nuevo');
      expect(result.email).toBe('nuevo@test.com');
      expect(result.docType).toBe('RNC');
    });

    it('permite guardar el mismo docNumber sin disparar el chequeo de duplicado', async () => {
      clientRepo.findOne.mockResolvedValueOnce({ id: 'client-1', docNumber: '001-0000000-0' });

      const result = await service.update('client-1', { docNumber: '001-0000000-0' } as any);

      expect(result.docNumber).toBe('001-0000000-0');
      expect(clientRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('lanza ConflictException si el nuevo docNumber ya pertenece a otro cliente', async () => {
      clientRepo.findOne
        .mockResolvedValueOnce({ id: 'client-1', docNumber: '001-0000000-0' })
        .mockResolvedValueOnce({ id: 'client-2', docNumber: '001-9999999-9' });

      await expect(service.update('client-1', { docNumber: '001-9999999-9' } as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('sincroniza el email del UserEntity vinculado cuando el cliente tiene cuenta digital', async () => {
      clientRepo.findOne.mockResolvedValueOnce({ id: 'client-1', userId: 'user-1', email: 'viejo@test.com' });

      await service.update('client-1', { email: 'NUEVO@Test.com' } as any);

      expect(userRepo.update).toHaveBeenCalledWith('user-1', { email: 'nuevo@test.com' });
    });

    it('no toca UserEntity si el cliente no tiene cuenta digital vinculada', async () => {
      clientRepo.findOne.mockResolvedValueOnce({ id: 'client-1', userId: undefined, email: 'viejo@test.com' });

      await service.update('client-1', { email: 'nuevo@test.com' } as any);

      expect(userRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('findById (cliente)', () => {
    it('lanza NotFoundException si el cliente no existe', async () => {
      clientRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.findById('client-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll (cliente)', () => {
    it('aplica paginación por defecto y devuelve la forma paginada estándar', async () => {
      const result = await service.findAll({} as any);

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
    });

    it('aplica el filtro de búsqueda cuando se provee', async () => {
      const qb = clientRepo.createQueryBuilder();
      await service.findAll({} as any, 'Carlos');

      expect(qb.where).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), { search: '%Carlos%' });
    });
  });

  describe('addContract', () => {
    it('el contrato nace ACTIVE (no PENDING_INSTALL) para que la facturación arranque desde la firma', async () => {
      const contract = await service.addContract('client-1', 'plan-1', 'addr-1');
      expect(contract.status).toBe('ACTIVE');
    });

    it('emite CONTRACT_CREATED con el id/clientId/contractNumber del contrato recién creado', async () => {
      const contract = await service.addContract('client-1', 'plan-1', 'addr-1');

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        SystemEvents.CONTRACT_CREATED,
        expect.objectContaining({
          contractId: contract.id,
          clientId: 'client-1',
          contractNumber: contract.contractNumber,
        }),
      );
    });

    it('usa billingDay=15 por defecto si no se especifica', async () => {
      const contract = await service.addContract('client-1', 'plan-1', 'addr-1');
      expect(contract.billingDay).toBe(15);
    });

    it('respeta el billingDay elegido por el cliente si es válido (1-31)', async () => {
      const contract = await service.addContract('client-1', 'plan-1', 'addr-1', 20);
      expect(contract.billingDay).toBe(20);
    });

    it('ignora un billingDay fuera de rango y usa el default 15', async () => {
      const contract = await service.addContract('client-1', 'plan-1', 'addr-1', 35);
      expect(contract.billingDay).toBe(15);
    });

    it('lanza NotFoundException si el plan no existe', async () => {
      planRepo.findOneBy.mockResolvedValue(null);

      await expect(service.addContract('client-1', 'plan-inexistente', 'addr-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza ConflictException si el plan existe pero está inactivo', async () => {
      planRepo.findOneBy.mockResolvedValue({ id: 'plan-1', name: 'Fibra 100 (retirado)', isActive: false });

      await expect(service.addContract('client-1', 'plan-1', 'addr-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('findAllContracts', () => {
    it('aplica paginación por defecto y devuelve la forma paginada estándar', async () => {
      const result = await service.findAllContracts({});

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 15, totalPages: 0 });
      expect(contractRepo.createQueryBuilder).toHaveBeenCalledWith('contract');
    });

    it('aplica filtros de status y search cuando se proveen', async () => {
      const qb = contractRepo.createQueryBuilder();
      await service.findAllContracts({ status: 'SUSPENDED', search: 'Carlos', page: 2, limit: 10 });

      expect(qb.andWhere).toHaveBeenCalledWith('contract.status = :status', { status: 'SUSPENDED' });
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('client.name ILIKE'),
        { search: '%Carlos%' },
      );
      expect(qb.skip).toHaveBeenCalledWith(10);
      expect(qb.take).toHaveBeenCalledWith(10);
    });
  });

  describe('updateContract', () => {
    it('lanza NotFoundException si el contrato no pertenece a ese cliente', async () => {
      contractRepo.findOne.mockResolvedValue(null);

      await expect(service.updateContract('client-1', 'contract-x', { billingDay: 20 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('actualiza solo los campos provistos', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', clientId: 'client-1', planId: 'plan-old', billingDay: 15 });

      const result = await service.updateContract('client-1', 'contract-1', { billingDay: 25 });

      expect(result.billingDay).toBe(25);
      expect(result.planId).toBe('plan-old');
    });

    it('permite cambiar de plan cuando el nuevo plan existe y está activo', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', clientId: 'client-1', planId: 'plan-old', billingDay: 15 });

      const result = await service.updateContract('client-1', 'contract-1', { planId: 'plan-1' });

      expect(result.planId).toBe('plan-1');
      expect(planRepo.findOneBy).toHaveBeenCalledWith({ id: 'plan-1' });
    });

    it('emite CONTRACT_PLAN_CHANGED con el plan viejo y el nuevo cuando el plan efectivamente cambia', async () => {
      contractRepo.findOne.mockResolvedValue({
        id: 'contract-1',
        clientId: 'client-1',
        contractNumber: 'CTR-0001',
        planId: 'plan-old',
        billingDay: 15,
      });

      await service.updateContract('client-1', 'contract-1', { planId: 'plan-1' });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        SystemEvents.CONTRACT_PLAN_CHANGED,
        expect.objectContaining({
          contractId: 'contract-1',
          clientId: 'client-1',
          contractNumber: 'CTR-0001',
          oldPlanId: 'plan-old',
          newPlanId: 'plan-1',
        }),
      );
    });

    it('NO emite CONTRACT_PLAN_CHANGED si no se envía planId', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', clientId: 'client-1', planId: 'plan-old', billingDay: 15 });

      await service.updateContract('client-1', 'contract-1', { billingDay: 20 });

      expect(eventEmitter.emit).not.toHaveBeenCalledWith(SystemEvents.CONTRACT_PLAN_CHANGED, expect.anything());
    });

    it('NO emite CONTRACT_PLAN_CHANGED si el planId enviado es el mismo que ya tenía', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', clientId: 'client-1', planId: 'plan-1', billingDay: 15 });

      await service.updateContract('client-1', 'contract-1', { planId: 'plan-1' });

      expect(eventEmitter.emit).not.toHaveBeenCalledWith(SystemEvents.CONTRACT_PLAN_CHANGED, expect.anything());
    });

    it('lanza NotFoundException si se intenta mover el contrato a un plan inexistente', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', clientId: 'client-1', planId: 'plan-old', billingDay: 15 });
      planRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateContract('client-1', 'contract-1', { planId: 'plan-inexistente' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza ConflictException si se intenta mover el contrato a un plan inactivo', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', clientId: 'client-1', planId: 'plan-old', billingDay: 15 });
      planRepo.findOneBy.mockResolvedValue({ id: 'plan-2', name: 'Plan Retirado', isActive: false });

      await expect(
        service.updateContract('client-1', 'contract-1', { planId: 'plan-2' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('suspendContract / reactivateContract', () => {
    it('suspende un contrato ACTIVE y emite CONTRACT_SUSPENDED', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', clientId: 'client-1', contractNumber: 'CTR-0001', status: 'ACTIVE' });

      const result = await service.suspendContract('client-1', 'contract-1');

      expect(result.status).toBe('SUSPENDED');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        SystemEvents.CONTRACT_SUSPENDED,
        expect.objectContaining({
          contractId: 'contract-1',
          clientId: 'client-1',
          reason: 'Suspensión manual por administrador.',
        }),
      );
    });

    it('lanza ConflictException al intentar suspender un contrato que no está ACTIVE', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', clientId: 'client-1', status: 'SUSPENDED' });

      await expect(service.suspendContract('client-1', 'contract-1')).rejects.toThrow(ConflictException);
    });

    it('reactiva un contrato SUSPENDED y emite CONTRACT_REACTIVATED', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', clientId: 'client-1', contractNumber: 'CTR-0001', status: 'SUSPENDED' });

      const result = await service.reactivateContract('client-1', 'contract-1');

      expect(result.status).toBe('ACTIVE');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        SystemEvents.CONTRACT_REACTIVATED,
        expect.objectContaining({
          contractId: 'contract-1',
          clientId: 'client-1',
          reason: 'Reactivación manual por administrador.',
        }),
      );
    });

    it('lanza ConflictException al intentar reactivar un contrato que no está SUSPENDED', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', clientId: 'client-1', status: 'ACTIVE' });

      await expect(service.reactivateContract('client-1', 'contract-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('terminateContract', () => {
    it.each(['PENDING_INSTALL', 'ACTIVE', 'SUSPENDED'])(
      'termina un contrato %s, setea endDate y emite CONTRACT_TERMINATED',
      async (status) => {
        contractRepo.findOne.mockResolvedValue({ id: 'contract-1', clientId: 'client-1', contractNumber: 'CTR-0001', status });

        const result = await service.terminateContract('client-1', 'contract-1');

        expect(result.status).toBe('TERMINATED');
        expect(result.endDate).toBeTruthy();
        expect(eventEmitter.emit).toHaveBeenCalledWith(
          SystemEvents.CONTRACT_TERMINATED,
          expect.objectContaining({
            contractId: 'contract-1',
            clientId: 'client-1',
            contractNumber: 'CTR-0001',
            reason: 'Terminación manual por administrador.',
          }),
        );
      },
    );

    it('lanza ConflictException si el contrato ya está TERMINATED', async () => {
      contractRepo.findOne.mockResolvedValue({ id: 'contract-1', clientId: 'client-1', status: 'TERMINATED' });

      await expect(service.terminateContract('client-1', 'contract-1')).rejects.toThrow(ConflictException);
    });

    it('lanza NotFoundException si el contrato no pertenece a ese cliente', async () => {
      contractRepo.findOne.mockResolvedValue(null);

      await expect(service.terminateContract('client-1', 'contract-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getClientInvoices', () => {
    it('lanza NotFoundException si el cliente no existe', async () => {
      clientRepo.findOne.mockResolvedValue(null);

      await expect(service.getClientInvoices('client-x')).rejects.toThrow(NotFoundException);
    });

    it('filtra por clientId directamente en Invoice (incluye PENDING_PAYMENT sin venta)', async () => {
      invoiceRepo.find.mockResolvedValue([{ id: 'inv-1', clientId: 'client-1', status: 'PENDING_PAYMENT' }]);

      const result = await service.getClientInvoices('client-1');

      expect(invoiceRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { clientId: 'client-1' } }),
      );
      expect(result).toHaveLength(1);
    });

    it('aplica el filtro de status cuando se provee', async () => {
      await service.getClientInvoices('client-1', 'PENDING_PAYMENT');

      expect(invoiceRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { clientId: 'client-1', status: 'PENDING_PAYMENT' } }),
      );
    });
  });

  describe('generateContractPdf', () => {
    it('lanza NotFoundException si el contrato no pertenece a ese cliente', async () => {
      contractRepo.findOne.mockResolvedValue(null);

      await expect(service.generateContractPdf('client-1', 'contract-x')).rejects.toThrow(NotFoundException);
    });

    it('arma los datos del contrato y delega la generación del PDF al PdfGeneratorService', async () => {
      contractRepo.findOne.mockResolvedValue({
        id: 'contract-1',
        clientId: 'client-1',
        contractNumber: 'CTR-000001',
        status: 'ACTIVE',
        startDate: '2026-03-01',
        billingDay: 15,
        client: { name: 'Juan Perez', docType: 'CEDULA', docNumber: '00112223334', email: 'juan@a.com', phone: '8095551234' },
        plan: { name: 'Fibra 100', serviceType: 'INTERNET', speedMbps: 100, tvChannelsCount: 0, monthlyPrice: 1500 },
        address: { street: 'Calle Duarte', buildingNumber: '12', sector: 'Centro', municipality: 'Santo Domingo', city: 'Santo Domingo' },
      });

      const buffer = await service.generateContractPdf('client-1', 'contract-1');

      expect(buffer.toString('latin1')).toContain('%PDF-1.4');
      expect(pdfGenerator.generateContractPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          contract: expect.objectContaining({ contractNumber: 'CTR-000001' }),
          client: expect.objectContaining({ name: 'Juan Perez' }),
          plan: expect.objectContaining({ name: 'Fibra 100' }),
          signatures: { client: undefined, company: undefined },
        }),
      );
    });

    it('pasa las firmas del cliente y de la empresa al PdfGeneratorService cuando ambas existen', async () => {
      contractRepo.findOne.mockResolvedValue({
        id: 'contract-1',
        clientId: 'client-1',
        contractNumber: 'CTR-000001',
        status: 'ACTIVE',
        startDate: '2026-03-01',
        billingDay: 15,
        client: { name: 'Juan Perez', docType: 'CEDULA', docNumber: '00112223334', email: 'juan@a.com', phone: '8095551234' },
        plan: { name: 'Fibra 100', serviceType: 'INTERNET', speedMbps: 100, tvChannelsCount: 0, monthlyPrice: 1500 },
        address: { street: 'Calle Duarte', buildingNumber: '12', sector: 'Centro', municipality: 'Santo Domingo', city: 'Santo Domingo' },
      });
      const clientSignature = { buffer: Buffer.from('firma-cliente'), signedByName: 'Juan Perez', signedAt: new Date('2026-03-01T10:00:00Z') };
      const companySignature = { buffer: Buffer.from('firma-empresa'), signedByName: 'Maria Representante', signedAt: new Date('2026-03-01T10:05:00Z') };
      contractSignatures.getLatestBufferForPdf
        .mockResolvedValueOnce(clientSignature)
        .mockResolvedValueOnce(companySignature);

      await service.generateContractPdf('client-1', 'contract-1');

      expect(contractSignatures.getLatestBufferForPdf).toHaveBeenCalledWith('contract-1', 'CLIENT');
      expect(contractSignatures.getLatestBufferForPdf).toHaveBeenCalledWith('contract-1', 'COMPANY');
      expect(pdfGenerator.generateContractPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          signatures: {
            client: { imageBuffer: clientSignature.buffer, signedByName: 'Juan Perez', signedAt: clientSignature.signedAt },
            company: { imageBuffer: companySignature.buffer, signedByName: 'Maria Representante', signedAt: companySignature.signedAt },
          },
        }),
      );
    });

    it('utiliza la información fiscal de CompanyService cuando está disponible', async () => {
      contractRepo.findOne.mockResolvedValue({
        id: 'contract-2',
        clientId: 'client-2',
        contractNumber: 'CTR-000002',
        status: 'ACTIVE',
        startDate: '2026-03-01',
        billingDay: 15,
        client: { name: 'Pedro Gomez', docType: 'CEDULA', docNumber: '00112223335', email: 'p@a.com', phone: '8095559999' },
        plan: { name: 'Fibra 200', serviceType: 'INTERNET', speedMbps: 200, tvChannelsCount: 0, monthlyPrice: 2000 },
        address: { street: 'Av. Las Americas', buildingNumber: '4', sector: 'Este', municipality: 'Santo Domingo Este', city: 'Santo Domingo' },
      });

      const mockCompanyService = {
        getCompanyFiscalInfo: jest.fn().mockResolvedValue({
          rnc: '133000000',
          razonSocial: 'SUMTECH ORIENTE SRL',
          nombreComercial: 'SUMTECH BAVARO',
          direccion: 'Bulevar Turistico #50',
          telefono: '809-552-1111',
          correo: 'bavaro@sumtech.do',
        }),
      };

      (service as any).companyService = mockCompanyService;

      await service.generateContractPdf('client-2', 'contract-2');

      expect(mockCompanyService.getCompanyFiscalInfo).toHaveBeenCalled();
      expect(pdfGenerator.generateContractPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          company: expect.objectContaining({
            rnc: '133000000',
            razonSocial: 'SUMTECH ORIENTE SRL',
            nombreComercial: 'SUMTECH BAVARO',
          }),
        }),
      );
    });

    it('cuando el cliente tiene pendingPortalPassword, la embebe en el PDF y la limpia (nunca vuelve a aparecer)', async () => {
      contractRepo.findOne.mockResolvedValue({
        id: 'contract-1',
        clientId: 'client-1',
        contractNumber: 'CTR-000001',
        status: 'ACTIVE',
        startDate: '2026-03-01',
        billingDay: 15,
        client: { name: 'Juan Perez', docType: 'CEDULA', docNumber: '00112223334', email: 'juan@a.com', phone: '8095551234' },
        plan: { name: 'Fibra 100', serviceType: 'INTERNET', speedMbps: 100, tvChannelsCount: 0, monthlyPrice: 1500 },
        address: { street: 'Calle Duarte', buildingNumber: '12', sector: 'Centro', municipality: 'Santo Domingo', city: 'Santo Domingo' },
      });
      clientRepo.findOne.mockResolvedValueOnce({
        pendingPortalPassword: 'Ab12Cd',
        user: { username: 'juan001' },
      });

      await service.generateContractPdf('client-1', 'contract-1');

      expect(pdfGenerator.generateContractPdf).toHaveBeenCalledWith(
        expect.objectContaining({ portalCredentials: { username: 'juan001', password: 'Ab12Cd' } }),
      );
      expect(clientRepo.update).toHaveBeenCalledWith('client-1', { pendingPortalPassword: null });
    });

    it('sin pendingPortalPassword (ya se imprimió antes, o nunca tuvo), no incluye credenciales ni las vuelve a tocar', async () => {
      contractRepo.findOne.mockResolvedValue({
        id: 'contract-1',
        clientId: 'client-1',
        contractNumber: 'CTR-000001',
        status: 'ACTIVE',
        startDate: '2026-03-01',
        billingDay: 15,
        client: { name: 'Juan Perez', docType: 'CEDULA', docNumber: '00112223334', email: 'juan@a.com', phone: '8095551234' },
        plan: { name: 'Fibra 100', serviceType: 'INTERNET', speedMbps: 100, tvChannelsCount: 0, monthlyPrice: 1500 },
        address: { street: 'Calle Duarte', buildingNumber: '12', sector: 'Centro', municipality: 'Santo Domingo', city: 'Santo Domingo' },
      });
      clientRepo.findOne.mockResolvedValueOnce({ pendingPortalPassword: null, user: { username: 'juan001' } });

      await service.generateContractPdf('client-1', 'contract-1');

      expect(pdfGenerator.generateContractPdf).toHaveBeenCalledWith(
        expect.objectContaining({ portalCredentials: undefined }),
      );
      expect(clientRepo.update).not.toHaveBeenCalled();
    });
  });
});

