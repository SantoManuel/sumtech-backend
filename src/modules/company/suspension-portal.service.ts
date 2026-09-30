import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompanyProfileEntity } from './entities/company-profile.entity';
import { NetworkAccessEntity } from '../network/entities/network-access.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';

export interface SuspensionPortalIdentificationResult {
  found: boolean;
  clientName?: string;
  contractNumber?: string;
  planName?: string;
  serviceStatus?: string;
  suspensionReason?: string;
  overdueInvoicesCount: number;
  totalBalanceDue: number;
  dueDate?: string;
  company: {
    name: string;
    commercialName?: string;
    logoUrl?: string;
    phone?: string;
    whatsapp?: string;
    suspensionPortal: Record<string, any>;
  };
}

@Injectable()
export class SuspensionPortalService {
  private readonly logger = new Logger(SuspensionPortalService.name);

  constructor(
    @InjectRepository(CompanyProfileEntity)
    private readonly companyProfileRepository: Repository<CompanyProfileEntity>,
    @InjectRepository(NetworkAccessEntity)
    private readonly accessRepository: Repository<NetworkAccessEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(InvoiceEntity)
    private readonly invoiceRepository: Repository<InvoiceEntity>,
  ) {}

  /**
   * Identifica al cliente por la IP interceptada por el dst-nat o por búsqueda manual (cédula/contrato).
   * RF-PORTAL-002.
   */
  async identifyClient(params: {
    ip?: string;
    search?: string;
  }): Promise<SuspensionPortalIdentificationResult> {
    const company = await this.companyProfileRepository.findOne({ where: {} });
    const defaultPortalConfig = {
      title: 'Aviso de Suspensión de Servicio',
      message:
        'Estimado cliente, su servicio de Internet presenta facturas vencidas pendientes de pago. Le invitamos a realizar su pago para reactivar su conexión de inmediato.',
      primaryColor: '#0891b2',
      accentColor: '#f59e0b',
      paymentMethods: [
        'Transferencia Bancaria',
        'Pago en Efectivo',
        'Punto de Venta POS',
        'Depósito en Ventanilla',
      ],
      bankAccounts: [
        { bank: 'Banco Popular', accountType: 'Corriente', accountNumber: '789123456', accountHolder: company?.name || 'ISP Telecom' },
        { bank: 'Banco BHD', accountType: 'Ahorros', accountNumber: '123456789', accountHolder: company?.name || 'ISP Telecom' },
      ],
      supportPhone: company?.phone || '',
      supportWhatsapp: company?.whatsapp || company?.phone || '',
      enableChatbot: true,
    };

    const companyData = {
      name: company?.name || 'ISP Telecom',
      commercialName: company?.commercialName,
      logoUrl: company?.logoUrl,
      phone: company?.phone,
      whatsapp: company?.whatsapp || company?.phone,
      suspensionPortal: {
        ...defaultPortalConfig,
        ...(company?.suspensionPortal || {}),
      },
    };

    let targetContract: ContractEntity | null = null;

    // 1. Intentar identificación automática por IP del cliente en la red
    if (params.ip) {
      const cleanIp = params.ip.replace('::ffff:', '').trim();
      const access = await this.accessRepository
        .createQueryBuilder('access')
        .leftJoinAndSelect('access.contract', 'contract')
        .leftJoinAndSelect('contract.client', 'client')
        .leftJoinAndSelect('contract.plan', 'plan')
        .where('access.remoteAddress = :ip', { ip: cleanIp })
        .orWhere('access.currentIp = :ip', { ip: cleanIp })
        .getOne();

      if (access?.contract) {
        targetContract = access.contract;
      }
    }

    // 2. Si no se encontró por IP o se ingresó búsqueda manual
    if (!targetContract && params.search) {
      const q = params.search.trim();
      targetContract = await this.contractRepository
        .createQueryBuilder('contract')
        .leftJoinAndSelect('contract.client', 'client')
        .leftJoinAndSelect('contract.plan', 'plan')
        .where('contract.contractNumber ILIKE :q', { q })
        .orWhere('client.docNumber ILIKE :q', { q })
        .orWhere('client.phone ILIKE :q', { q })
        .getOne();
    }

    if (!targetContract) {
      return {
        found: false,
        overdueInvoicesCount: 0,
        totalBalanceDue: 0,
        company: companyData,
      };
    }

    // 3. Consultar facturas vencidas o pendientes asociadas a este contrato
    const invoices = await this.invoiceRepository.find({
      where: [
        { contractId: targetContract.id, status: 'VENCIDA' },
        { contractId: targetContract.id, status: 'EN_GRACIA' },
        { contractId: targetContract.id, status: 'PENDING_PAYMENT' },
      ],
      order: { dueDate: 'ASC' },
    });

    const totalBalance = invoices.reduce((acc, inv) => acc + Number(inv.grandTotal ?? inv.subtotal ?? 0), 0);
    const earliestDueDate = invoices.length > 0 && invoices[0].dueDate ? invoices[0].dueDate : undefined;

    return {
      found: true,
      clientName: targetContract.client?.name || 'Abonado',
      contractNumber: targetContract.contractNumber,
      planName: targetContract.plan?.name || 'Servicio de Internet',
      serviceStatus: targetContract.status,
      suspensionReason:
        targetContract.status === 'SUSPENDED'
          ? 'Suspensión administrativa por balance pendiente'
          : 'Servicio con avisos pendientes',
      overdueInvoicesCount: invoices.length,
      totalBalanceDue: totalBalance,
      dueDate: earliestDueDate,
      company: companyData,
    };
  }

  /**
   * Obtiene la configuración actual del portal de aviso.
   */
  async getPortalConfig(): Promise<any> {
    const company = await this.companyProfileRepository.findOne({ where: {} });
    return {
      whatsapp: company?.whatsapp,
      suspensionPortal: company?.suspensionPortal || {},
      telegramAlertsEnabled: company?.telegramAlertsEnabled || false,
      telegramChatId: company?.telegramChatId || '',
      hasTelegramToken: Boolean(company?.telegramBotToken),
    };
  }

  /**
   * Actualiza la configuración y personalización del portal de suspensión (RF-PORTAL-003).
   */
  async updatePortalConfig(dto: {
    whatsapp?: string;
    suspensionPortal?: Record<string, any>;
    telegramBotToken?: string;
    telegramChatId?: string;
    telegramAlertsEnabled?: boolean;
  }): Promise<any> {
    let company = await this.companyProfileRepository.findOne({ where: {} });
    if (!company) {
      company = this.companyProfileRepository.create({
        name: 'Sumtech ISP',
        companyName: 'Sumtech ISP SRL',
        rnc: '000000000',
      });
    }

    if (dto.whatsapp !== undefined) company.whatsapp = dto.whatsapp;
    if (dto.suspensionPortal !== undefined) {
      company.suspensionPortal = {
        ...company.suspensionPortal,
        ...dto.suspensionPortal,
      };
    }
    if (dto.telegramBotToken !== undefined) company.telegramBotToken = dto.telegramBotToken;
    if (dto.telegramChatId !== undefined) company.telegramChatId = dto.telegramChatId;
    if (dto.telegramAlertsEnabled !== undefined) company.telegramAlertsEnabled = dto.telegramAlertsEnabled;

    await this.companyProfileRepository.save(company);
    return this.getPortalConfig();
  }
}
