import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PortalService } from './portal.service';
import { ClientEntity } from '../clients/entities/client.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { PlanEntity } from '../plans/entities/plan.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { SerialNumberEntity } from '../inventory/entities/serial-number.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { EmployeeEntity } from '../employees/entities/employee.entity';
import { InteractionEntity } from '../crm/entities/interaction.entity';
import { DepositProofEntity } from './entities/deposit-proof.entity';
import { PlanChangeRequestEntity } from './entities/plan-change-request.entity';
import { ClientNotificationEntity } from './entities/client-notification.entity';
import { PosService } from '../pos/pos.service';
import { MinioStorageService } from '../storage/minio-storage.service';
import { AiChatbotClientService } from '../ai-chatbot/ai-chatbot-client.service';

describe('PortalService - conciliación de depósitos', () => {
  let service: PortalService;
  let depositProofRepo: any;
  let invoiceRepo: any;
  let clientRepo: any;
  let notificationRepo: any;
  let posService: any;
  let storageService: any;

  const emptyRepo = () => ({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn((x: any) => x) });

  beforeEach(async () => {
    depositProofRepo = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
      create: jest.fn((dto: any) => dto),
    };
    invoiceRepo = {
      findOne: jest.fn(),
    };
    clientRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'client-1', docType: 'CEDULA' }),
    };
    notificationRepo = {
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    posService = {
      collectInvoices: jest.fn(),
    };
    storageService = {
      uploadBuffer: jest.fn().mockResolvedValue('deposit-proofs/client-1/file-key.jpg'),
      getPresignedUrl: jest.fn().mockResolvedValue('https://minio.local/signed-url'),
    };
    const aiChatbotClient = {
      sendMessage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortalService,
        { provide: AiChatbotClientService, useValue: aiChatbotClient },
        { provide: getRepositoryToken(ClientEntity), useValue: clientRepo },
        { provide: getRepositoryToken(ContractEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(PlanEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(InvoiceEntity), useValue: invoiceRepo },
        { provide: getRepositoryToken(SerialNumberEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(TicketEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(EmployeeEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(InteractionEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(DepositProofEntity), useValue: depositProofRepo },
        { provide: getRepositoryToken(PlanChangeRequestEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(ClientNotificationEntity), useValue: notificationRepo },
        { provide: PosService, useValue: posService },
        { provide: MinioStorageService, useValue: storageService },
      ],
    }).compile();

    service = module.get<PortalService>(PortalService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('submitDepositProof', () => {
    const validFile = {
      buffer: Buffer.from('contenido-falso-de-imagen'),
      originalname: 'recibo.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
    } as Express.Multer.File;

    const validDto = {
      bankName: 'Banco Popular Dominicano',
      referenceNumber: 'TRF-982341',
      amount: 1500,
      depositDate: '2026-09-11',
    };

    it('lanza BadRequestException si no se adjunta ningún archivo', async () => {
      await expect(service.submitDepositProof('user-1', validDto as any, undefined)).rejects.toThrow(
        BadRequestException,
      );
      expect(storageService.uploadBuffer).not.toHaveBeenCalled();
      expect(depositProofRepo.save).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si el archivo llega vacío (size 0)', async () => {
      const emptyFile = { ...validFile, size: 0, buffer: Buffer.alloc(0) };

      await expect(service.submitDepositProof('user-1', validDto as any, emptyFile as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si el tipo de archivo no está permitido', async () => {
      const badFile = { ...validFile, mimetype: 'application/zip' };

      await expect(service.submitDepositProof('user-1', validDto as any, badFile as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(storageService.uploadBuffer).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si el archivo supera los 5MB', async () => {
      const bigFile = { ...validFile, size: 5 * 1024 * 1024 + 1 };

      await expect(service.submitDepositProof('user-1', validDto as any, bigFile as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(storageService.uploadBuffer).not.toHaveBeenCalled();
    });

    it('acepta un PDF como comprobante válido', async () => {
      const pdfFile = { ...validFile, originalname: 'recibo.pdf', mimetype: 'application/pdf' };

      const result = await service.submitDepositProof('user-1', validDto as any, pdfFile as any);

      expect(storageService.uploadBuffer).toHaveBeenCalledWith(
        pdfFile.buffer,
        pdfFile.originalname,
        'deposit-proofs/client-1',
        'application/pdf',
      );
      expect(result.receiptFileKey).toBe('deposit-proofs/client-1/file-key.jpg');
      expect(result.receiptMimeType).toBe('application/pdf');
    });

    it('sube el archivo a MinIO (con su Content-Type) y guarda el comprobante con receiptFileKey y receiptMimeType (sin receiptUrl)', async () => {
      const result = await service.submitDepositProof('user-1', validDto as any, validFile);

      expect(storageService.uploadBuffer).toHaveBeenCalledWith(
        validFile.buffer,
        validFile.originalname,
        'deposit-proofs/client-1',
        'image/jpeg',
      );
      expect(depositProofRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-1',
          bankName: validDto.bankName,
          referenceNumber: validDto.referenceNumber,
          amount: validDto.amount,
          receiptFileKey: 'deposit-proofs/client-1/file-key.jpg',
          receiptMimeType: 'image/jpeg',
        }),
      );
      expect(depositProofRepo.create).not.toHaveBeenCalledWith(expect.objectContaining({ receiptUrl: expect.anything() }));
      expect(result.status).toBe('PENDING_REVIEW');
      expect(notificationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'client-1', type: 'PAYMENT_CONFIRMED' }),
      );
    });
  });

  describe('getAllDepositProofs', () => {
    it('lista todos los comprobantes sin filtro de cliente cuando no se provee status', async () => {
      depositProofRepo.find.mockResolvedValue([{ id: 'proof-1' }, { id: 'proof-2' }]);

      const result = await service.getAllDepositProofs();

      expect(depositProofRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, relations: ['client'] }),
      );
      expect(result).toHaveLength(2);
    });

    it('filtra por status cuando se provee', async () => {
      await service.getAllDepositProofs('PENDING_REVIEW');

      expect(depositProofRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PENDING_REVIEW' } }),
      );
    });

    it('resuelve receiptUrl como una URL firmada de MinIO cuando el comprobante tiene receiptFileKey', async () => {
      depositProofRepo.find.mockResolvedValue([{ id: 'proof-1', receiptFileKey: 'deposit-proofs/client-1/foo.jpg' }]);

      const [result] = await service.getAllDepositProofs();

      expect(storageService.getPresignedUrl).toHaveBeenCalledWith('deposit-proofs/client-1/foo.jpg');
      expect(result.receiptUrl).toBe('https://minio.local/signed-url');
    });

    it('cae de vuelta al receiptUrl legado cuando el comprobante no tiene receiptFileKey', async () => {
      depositProofRepo.find.mockResolvedValue([{ id: 'proof-1', receiptUrl: 'https://legado.example.com/foto.jpg' }]);

      const [result] = await service.getAllDepositProofs();

      expect(storageService.getPresignedUrl).not.toHaveBeenCalled();
      expect(result.receiptUrl).toBe('https://legado.example.com/foto.jpg');
    });

    it('retorna receiptUrl null cuando no hay ni receiptFileKey ni receiptUrl legado', async () => {
      depositProofRepo.find.mockResolvedValue([{ id: 'proof-1' }]);

      const [result] = await service.getAllDepositProofs();

      expect(result.receiptUrl).toBeNull();
    });
  });

  describe('getDepositProofs', () => {
    it('resuelve receiptUrl como URL firmada para los comprobantes propios del cliente autenticado', async () => {
      depositProofRepo.find.mockResolvedValue([{ id: 'proof-1', receiptFileKey: 'deposit-proofs/client-1/foo.jpg' }]);

      const [result] = await service.getDepositProofs('user-1');

      expect(depositProofRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { clientId: 'client-1' } }),
      );
      expect(result.receiptUrl).toBe('https://minio.local/signed-url');
    });
  });

  describe('approveDepositProof', () => {
    it('lanza NotFoundException si el comprobante no existe', async () => {
      depositProofRepo.findOne.mockResolvedValue(null);

      await expect(service.approveDepositProof('proof-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si el comprobante ya fue revisado', async () => {
      depositProofRepo.findOne.mockResolvedValue({ id: 'proof-1', status: 'APPROVED' });

      await expect(service.approveDepositProof('proof-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('aplica automáticamente el depósito si el monto coincide exacto con la factura pendiente más antigua', async () => {
      const proof = { id: 'proof-1', status: 'PENDING_REVIEW', clientId: 'client-1', amount: 2634, bankName: 'Banreservas', referenceNumber: 'REF-1' };
      depositProofRepo.findOne.mockResolvedValueOnce(proof).mockResolvedValueOnce(proof);
      depositProofRepo.findOneOrFail.mockResolvedValue({ ...proof, status: 'APPROVED', invoiceId: 'inv-1' });
      invoiceRepo.findOne
        .mockResolvedValueOnce({ id: 'inv-1', clientId: 'client-1', grandTotal: 2634, status: 'PENDING_PAYMENT' }) // oldestPending lookup
        .mockResolvedValueOnce({ id: 'inv-1', clientId: 'client-1', grandTotal: 2634, status: 'PENDING_PAYMENT' }); // applyDepositProofToInvoice lookup
      posService.collectInvoices.mockResolvedValue([{ id: 'sale-1', invoice: { id: 'inv-1', status: 'ISSUED' } }]);

      await service.approveDepositProof('proof-1', 'user-1');

      expect(posService.collectInvoices).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ invoiceIds: ['inv-1'], paymentMethod: 'BANK_TRANSFER' }),
      );
      expect(notificationRepo.save).not.toHaveBeenCalled();
    });

    it('no aplica automáticamente y solo notifica si el monto no coincide con ninguna factura pendiente', async () => {
      const proof = { id: 'proof-1', status: 'PENDING_REVIEW', clientId: 'client-1', amount: 999 };
      depositProofRepo.findOne.mockResolvedValueOnce(proof);
      depositProofRepo.findOneOrFail.mockResolvedValue({ ...proof, status: 'APPROVED' });
      invoiceRepo.findOne.mockResolvedValueOnce({ id: 'inv-1', clientId: 'client-1', grandTotal: 2634, status: 'PENDING_PAYMENT' });

      await service.approveDepositProof('proof-1', 'user-1');

      expect(posService.collectInvoices).not.toHaveBeenCalled();
      expect(notificationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'client-1', type: 'PAYMENT_CONFIRMED' }),
      );
    });

    it('no aplica automáticamente si el cliente no tiene ninguna factura pendiente', async () => {
      const proof = { id: 'proof-1', status: 'PENDING_REVIEW', clientId: 'client-1', amount: 2634 };
      depositProofRepo.findOne.mockResolvedValueOnce(proof);
      depositProofRepo.findOneOrFail.mockResolvedValue({ ...proof, status: 'APPROVED' });
      invoiceRepo.findOne.mockResolvedValueOnce(null);

      await service.approveDepositProof('proof-1', 'user-1');

      expect(posService.collectInvoices).not.toHaveBeenCalled();
      expect(notificationRepo.save).toHaveBeenCalled();
    });
  });

  describe('rejectDepositProof', () => {
    it('lanza NotFoundException si el comprobante no existe', async () => {
      depositProofRepo.findOne.mockResolvedValue(null);

      await expect(service.rejectDepositProof('proof-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si el comprobante ya fue revisado', async () => {
      depositProofRepo.findOne.mockResolvedValue({ id: 'proof-1', status: 'REJECTED' });

      await expect(service.rejectDepositProof('proof-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('marca el comprobante como REJECTED, guarda el motivo y notifica al cliente', async () => {
      depositProofRepo.findOne.mockResolvedValue({ id: 'proof-1', status: 'PENDING_REVIEW', clientId: 'client-1', amount: 500 });

      const result = await service.rejectDepositProof('proof-1', 'user-1', 'Referencia bancaria inválida');

      expect(result.status).toBe('REJECTED');
      expect(result.reviewNotes).toBe('Referencia bancaria inválida');
      expect(result.reviewedByUserId).toBe('user-1');
      expect(notificationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'client-1', type: 'PAYMENT_CONFIRMED' }),
      );
    });
  });

  describe('applyDepositProofToInvoice', () => {
    it('lanza BadRequestException si el comprobante no está APPROVED', async () => {
      depositProofRepo.findOne.mockResolvedValue({ id: 'proof-1', status: 'PENDING_REVIEW' });

      await expect(service.applyDepositProofToInvoice('proof-1', 'inv-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si la factura no pertenece al mismo cliente del comprobante', async () => {
      depositProofRepo.findOne.mockResolvedValue({ id: 'proof-1', status: 'APPROVED', clientId: 'client-1' });
      invoiceRepo.findOne.mockResolvedValue({ id: 'inv-1', clientId: 'client-OTRO', status: 'PENDING_PAYMENT' });

      await expect(service.applyDepositProofToInvoice('proof-1', 'inv-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si la factura ya no está pendiente de pago', async () => {
      depositProofRepo.findOne.mockResolvedValue({ id: 'proof-1', status: 'APPROVED', clientId: 'client-1' });
      invoiceRepo.findOne.mockResolvedValue({ id: 'inv-1', clientId: 'client-1', status: 'ISSUED' });

      await expect(service.applyDepositProofToInvoice('proof-1', 'inv-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('elige NCF tipo E31 si el cliente es RNC y E32 en caso contrario', async () => {
      depositProofRepo.findOne.mockResolvedValue({ id: 'proof-1', status: 'APPROVED', clientId: 'client-1', bankName: 'BHD', referenceNumber: 'REF-9' });
      invoiceRepo.findOne.mockResolvedValue({ id: 'inv-1', clientId: 'client-1', status: 'PENDING_PAYMENT' });
      clientRepo.findOne.mockResolvedValue({ id: 'client-1', docType: 'RNC' });
      posService.collectInvoices.mockResolvedValue([{ id: 'sale-1', invoice: { id: 'inv-1', status: 'ISSUED' } }]);

      await service.applyDepositProofToInvoice('proof-1', 'inv-1', 'user-1');

      expect(posService.collectInvoices).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ ncfType: 'E31' }),
      );
    });

    it('liquida la factura vía PosService.collectInvoices con BANK_TRANSFER y sin caja registradora', async () => {
      depositProofRepo.findOne.mockResolvedValue({ id: 'proof-1', status: 'APPROVED', clientId: 'client-1', bankName: 'BHD', referenceNumber: 'REF-9' });
      invoiceRepo.findOne.mockResolvedValue({ id: 'inv-1', clientId: 'client-1', status: 'PENDING_PAYMENT' });
      posService.collectInvoices.mockResolvedValue([{ id: 'sale-1', invoice: { id: 'inv-1', status: 'ISSUED', ncfNumber: 'E3200000001' } }]);

      const invoice = await service.applyDepositProofToInvoice('proof-1', 'inv-1', 'user-1');

      expect(posService.collectInvoices).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ invoiceIds: ['inv-1'], paymentMethod: 'BANK_TRANSFER' }),
      );
      expect(posService.collectInvoices.mock.calls[0][1].cashRegisterId).toBeUndefined();
      expect(invoice.status).toBe('ISSUED');
      expect(depositProofRepo.save).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: 'inv-1' }));
    });
  });

  describe('markAllNotificationsRead', () => {
    it('marca solo las notificaciones no leídas del cliente autenticado', async () => {
      const result = await service.markAllNotificationsRead('user-1');

      expect(notificationRepo.update).toHaveBeenCalledWith(
        { clientId: 'client-1', isRead: false },
        { isRead: true },
      );
      expect(result).toEqual({ success: true, updated: 1 });
    });

    it('retorna updated: 0 si no había ninguna notificación pendiente de marcar', async () => {
      notificationRepo.update.mockResolvedValueOnce({ affected: 0 });

      const result = await service.markAllNotificationsRead('user-1');

      expect(result).toEqual({ success: true, updated: 0 });
    });
  });

  describe('deleteNotification', () => {
    it('elimina la notificación del cliente autenticado', async () => {
      const result = await service.deleteNotification('user-1', 'notif-1');

      expect(notificationRepo.delete).toHaveBeenCalledWith({ id: 'notif-1', clientId: 'client-1' });
      expect(result).toEqual({ success: true });
    });

    it('lanza NotFoundException si la notificación no existe o no pertenece al cliente', async () => {
      notificationRepo.delete.mockResolvedValueOnce({ affected: 0 });

      await expect(service.deleteNotification('user-1', 'notif-inexistente')).rejects.toThrow(NotFoundException);
    });
  });
});

describe('PortalService - getTickets', () => {
  let service: PortalService;
  let clientRepo: any;
  let ticketRepo: any;
  let queryBuilderMock: any;

  const emptyRepo = () => ({ find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn((x: any) => x) });

  const mockQueryResult = (data: any[], total: number) => {
    queryBuilderMock.getManyAndCount.mockResolvedValue([data, total]);
  };

  beforeEach(async () => {
    queryBuilderMock = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    clientRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'client-1', docType: 'CEDULA' }),
    };
    ticketRepo = {
      createQueryBuilder: jest.fn(() => queryBuilderMock),
    };
    const aiChatbotClient = { sendMessage: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortalService,
        { provide: AiChatbotClientService, useValue: aiChatbotClient },
        { provide: getRepositoryToken(ClientEntity), useValue: clientRepo },
        { provide: getRepositoryToken(ContractEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(PlanEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(InvoiceEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(SerialNumberEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: getRepositoryToken(EmployeeEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(InteractionEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(DepositProofEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(PlanChangeRequestEntity), useValue: emptyRepo() },
        { provide: getRepositoryToken(ClientNotificationEntity), useValue: emptyRepo() },
        { provide: PosService, useValue: { collectInvoices: jest.fn() } },
        { provide: MinioStorageService, useValue: { uploadBuffer: jest.fn(), getPresignedUrl: jest.fn() } },
      ],
    }).compile();

    service = module.get<PortalService>(PortalService);
  });

  it('devuelve los tickets del cliente autenticado paginados', async () => {
    const tickets = [
      { id: 'tck-1', ticketNumber: 'TCK-2026-0001', status: 'OPEN' },
      { id: 'tck-2', ticketNumber: 'TCK-2026-0002', status: 'RESOLVED' },
    ];
    mockQueryResult(tickets, 2);

    const result = await service.getTickets('user-1', { page: 1, limit: 10 } as any);

    expect(clientRepo.findOne).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      relations: ['addresses', 'contracts', 'contracts.plan', 'contracts.address'],
    });
    expect(result).toEqual({ data: tickets, total: 2, page: 1, limit: 10, totalPages: 1 });
  });

  it('filtra por status cuando se provee', async () => {
    mockQueryResult([], 0);

    await service.getTickets('user-1', { status: 'RESOLVED' } as any);

    expect(queryBuilderMock.andWhere).toHaveBeenCalledWith('ticket.status = :status', { status: 'RESOLVED' });
  });

  it('filtra por contractId cuando se provee', async () => {
    mockQueryResult([], 0);

    await service.getTickets('user-1', { contractId: 'contract-9' } as any);

    expect(queryBuilderMock.andWhere).toHaveBeenCalledWith('ticket.contractId = :contractId', {
      contractId: 'contract-9',
    });
  });

  it('nunca consulta tickets fuera del cliente autenticado (scope por clientId)', async () => {
    mockQueryResult([], 0);

    await service.getTickets('user-1', {} as any);

    expect(queryBuilderMock.where).toHaveBeenCalledWith('ticket.clientId = :clientId', { clientId: 'client-1' });
  });

  it('retorna lista vacía sin lanzar error cuando el cliente no tiene tickets', async () => {
    mockQueryResult([], 0);

    const result = await service.getTickets('user-1', {} as any);

    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
  });

  it('usa page=1 y limit=10 por defecto cuando el DTO llega vacío', async () => {
    mockQueryResult([], 0);

    await service.getTickets('user-1', {} as any);

    expect(queryBuilderMock.skip).toHaveBeenCalledWith(0);
    expect(queryBuilderMock.take).toHaveBeenCalledWith(10);
  });
});
