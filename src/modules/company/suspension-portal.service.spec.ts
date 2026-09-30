import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SuspensionPortalService } from './suspension-portal.service';
import { CompanyProfileEntity } from './entities/company-profile.entity';
import { NetworkAccessEntity } from '../network/entities/network-access.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';

describe('SuspensionPortalService', () => {
  let service: SuspensionPortalService;

  const mockCompanyRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockAccessRepo = {
    createQueryBuilder: jest.fn(),
  };

  const mockContractRepo = {
    createQueryBuilder: jest.fn(),
  };

  const mockInvoiceRepo = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuspensionPortalService,
        { provide: getRepositoryToken(CompanyProfileEntity), useValue: mockCompanyRepo },
        { provide: getRepositoryToken(NetworkAccessEntity), useValue: mockAccessRepo },
        { provide: getRepositoryToken(ContractEntity), useValue: mockContractRepo },
        { provide: getRepositoryToken(InvoiceEntity), useValue: mockInvoiceRepo },
      ],
    }).compile();

    service = module.get<SuspensionPortalService>(SuspensionPortalService);
  });

  it('debe devolver found=false si no se encuentra cliente por IP ni por búsqueda manual', async () => {
    mockCompanyRepo.findOne.mockResolvedValue({ name: 'ISP Demo' });
    mockAccessRepo.createQueryBuilder.mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    });

    const result = await service.identifyClient({ ip: '10.0.0.99' });

    expect(result.found).toBe(false);
    expect(result.company.name).toBe('ISP Demo');
    expect(result.totalBalanceDue).toBe(0);
  });

  it('debe identificar al cliente por su IP asignada y calcular balance de facturas pendientes', async () => {
    mockCompanyRepo.findOne.mockResolvedValue({
      name: 'ISP Azua',
      phone: '809-555-0101',
      suspensionPortal: { title: 'Tu servicio está suspendido' },
    });

    const mockContract = {
      id: 'ctr-123',
      contractNumber: 'CTR-00123',
      status: 'SUSPENDED',
      client: { name: 'Carlos Gómez' },
      plan: { name: 'Plan Fibra 50M' },
    };

    mockAccessRepo.createQueryBuilder.mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'acc-1',
        remoteAddress: '10.15.1.50',
        contract: mockContract,
      }),
    });

    mockInvoiceRepo.find.mockResolvedValue([
      { id: 'inv-1', status: 'VENCIDA', grandTotal: 1500, dueDate: '2026-09-05' },
      { id: 'inv-2', status: 'EN_GRACIA', grandTotal: 1500, dueDate: '2026-09-25' },
    ]);

    const result = await service.identifyClient({ ip: '10.15.1.50' });

    expect(result.found).toBe(true);
    expect(result.clientName).toBe('Carlos Gómez');
    expect(result.contractNumber).toBe('CTR-00123');
    expect(result.overdueInvoicesCount).toBe(2);
    expect(result.totalBalanceDue).toBe(3000);
    expect(result.company.name).toBe('ISP Azua');
  });

  it('debe actualizar la configuración de personalización del portal', async () => {
    mockCompanyRepo.findOne.mockResolvedValue({
      name: 'ISP Test',
      suspensionPortal: {},
    });
    mockCompanyRepo.save.mockImplementation((c) => Promise.resolve(c));

    await service.updatePortalConfig({
      whatsapp: '809-999-8888',
      suspensionPortal: { title: 'Aviso Urgente' },
      telegramAlertsEnabled: true,
      telegramChatId: '-100123456789',
    });

    expect(mockCompanyRepo.save).toHaveBeenCalled();
  });
});
