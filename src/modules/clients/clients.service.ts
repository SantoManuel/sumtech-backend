import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { ClientEntity } from './entities/client.entity';
import { AddressEntity } from './entities/address.entity';
import { AddressGpsRequestEntity } from './entities/address-gps-request.entity';
import { AiChatbotClientService } from '../ai-chatbot/ai-chatbot-client.service';
import { ContractEntity } from './entities/contract.entity';
import { UserEntity } from '../users/entities/user.entity';
import { RoleEntity } from '../users/entities/role.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { PlanEntity } from '../plans/entities/plan.entity';
import { SectorEntity } from '../geography/entities/sector.entity';
import { Role } from '../../common/enums/role.enum';
import { SystemEvents } from '../../common/enums/system-events.enum';
import { ContractSuspendedEvent } from '../billing/events/contract-suspended.event';
import { ContractReactivatedEvent } from '../billing/events/contract-reactivated.event';
import { ContractTerminatedEvent } from '../billing/events/contract-terminated.event';
import { ContractCreatedEvent } from '../billing/events/contract-created.event';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { FindContractsDto } from './dto/find-contracts.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PdfGeneratorService } from '../printing/pdf-generator.service';
import { DgiiClientService } from '../invoicing/dgii/dgii-client.service';
import { ContractSignaturesService } from '../contract-signatures/contract-signatures.service';
import { CompanyService } from '../company/company.service';

function generateRandomPassword(length: number = 6): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(ClientEntity)
    private readonly clientRepository: Repository<ClientEntity>,
    @InjectRepository(AddressEntity)
    private readonly addressRepository: Repository<AddressEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    @InjectRepository(InvoiceEntity)
    private readonly invoiceRepository: Repository<InvoiceEntity>,
    @InjectRepository(PlanEntity)
    private readonly planRepository: Repository<PlanEntity>,
    @InjectRepository(SectorEntity)
    private readonly sectorRepository: Repository<SectorEntity>,
    @InjectRepository(AddressGpsRequestEntity)
    private readonly gpsRequestRepository: Repository<AddressGpsRequestEntity>,
    private readonly aiChatbotClient: AiChatbotClientService,
    private readonly eventEmitter: EventEmitter2,
    private readonly pdfGenerator: PdfGeneratorService,
    private readonly dgiiClient: DgiiClientService,
    private readonly contractSignatures: ContractSignaturesService,
    @Optional() private readonly companyService?: CompanyService,
  ) {}

  async findAll(paginationDto: PaginationDto, search?: string) {
    const page = paginationDto.page || 1;
    const limit = paginationDto.limit || 10;
    const skip = (page - 1) * limit;

    const query = this.clientRepository
      .createQueryBuilder('client')
      .leftJoinAndSelect('client.addresses', 'addresses')
      .leftJoinAndSelect('client.contracts', 'contracts')
      .leftJoinAndSelect('contracts.plan', 'plan')
      .leftJoinAndSelect('client.user', 'user')
      .skip(skip)
      .take(limit)
      .orderBy('client.createdAt', 'DESC');

    if (search) {
      query.where(
        'client.name ILIKE :search OR client.docNumber ILIKE :search OR client.email ILIKE :search OR client.phone ILIKE :search',
        { search: `%${search}%` },
      );
    }

    const [data, total] = await query.getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string): Promise<ClientEntity> {
    const client = await this.clientRepository.findOne({
      where: { id },
      relations: [
        'addresses',
        'contracts',
        'contracts.plan',
        'contracts.address',
        'sales',
        'sales.invoice',
        'user',
      ],
    });
    if (!client) {
      throw new NotFoundException(`Cliente con ID ${id} no encontrado`);
    }
    return client;
  }

  async findByDocNumber(docNumber: string): Promise<ClientEntity | null> {
    return this.clientRepository.findOne({
      where: { docNumber },
      relations: ['addresses', 'contracts', 'contracts.plan', 'user'],
    });
  }

  async create(dto: CreateClientDto): Promise<ClientEntity & { initialDigitalPassword?: string }> {
    const existing = await this.clientRepository.findOne({ where: { docNumber: dto.docNumber } });
    if (existing) {
      throw new ConflictException(`Ya existe un cliente con el documento ${dto.docNumber}`);
    }

    const addressData = { ...dto.address };
    if (addressData.sectorId) {
      const sector = await this.sectorRepository.findOne({
        where: { id: addressData.sectorId },
        relations: ['municipality', 'municipality.province', 'municipality.province.country'],
      });
      if (!sector) {
        throw new NotFoundException(`Sector con ID ${addressData.sectorId} no encontrado`);
      }
      // El texto libre (sector/municipality/city) se sincroniza a partir de la
      // relación normalizada para no romper a los lectores que todavía solo
      // conocen las columnas varchar (PDF de contrato, ticket de factura, etc.).
      addressData.sector = sector.name;
      addressData.municipality = sector.municipality.name;
      addressData.city = sector.municipality.province.name;
      addressData.countryId = sector.municipality.province.countryId;
      addressData.provinceId = sector.municipality.provinceId;
      addressData.municipalityId = sector.municipalityId;
    } else if (!addressData.sector || !addressData.municipality || !addressData.city) {
      throw new BadRequestException(
        'Debe indicar sectorId, o bien sector/municipality/city como texto libre',
      );
    }

    const address = this.addressRepository.create({
      ...addressData,
      isPrimary: true,
    });

    const client = this.clientRepository.create({
      clientType: dto.clientType,
      name: dto.name,
      docType: dto.docType,
      docNumber: dto.docNumber,
      email: dto.email,
      phone: dto.phone,
      altPhone: dto.altPhone,
      isActive: true,
      addresses: [address],
    });

    const savedClient = await this.clientRepository.save(client);

    // RF-35: Generación automática de Cuenta Digital de 6 caracteres con rol CLIENTE
    const initialPlainPassword = generateRandomPassword(6);
    const passwordHash = await bcrypt.hash(initialPlainPassword, 10);

    let clientRole = await this.roleRepository.findOneBy({ name: Role.CLIENTE });
    if (!clientRole) {
      clientRole = await this.roleRepository.save(
        this.roleRepository.create({
          name: Role.CLIENTE,
          description: 'Portal de Autoservicio y Autogestión del Cliente',
        }),
      );
    }

    // El nombre de usuario es la cédula / docNumber (o email si no hay)
    const digitalUsername = dto.docNumber.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || `usr_${Date.now()}`;
    const digitalEmail = dto.email.toLowerCase();

    // Comprobar si ya existe el usuario
    let digitalUser = await this.userRepository.findOne({
      where: [{ username: digitalUsername }, { email: digitalEmail }],
    });

    if (!digitalUser) {
      digitalUser = this.userRepository.create({
        username: digitalUsername,
        email: digitalEmail,
        passwordHash,
        isActive: true,
        roles: [clientRole],
      });
      await this.userRepository.save(digitalUser);
    }

    savedClient.userId = digitalUser.id;
    await this.clientRepository.save(savedClient);

    const result = savedClient as ClientEntity & { initialDigitalPassword?: string };
    result.initialDigitalPassword = initialPlainPassword;
    return result;
  }

  /**
   * Regenera la contraseña de la cuenta digital del cliente (portal de
   * autoservicio) — el hash original no es recuperable, así que esta es la
   * única forma de que el ERP le entregue una contraseña nueva a un cliente
   * que la perdió. Se devuelve en texto plano una sola vez, igual que en el
   * alta inicial (RF-35).
   */
  async resetDigitalPassword(clientId: string): Promise<{ initialDigitalPassword: string }> {
    const client = await this.findById(clientId);
    if (!client.userId) {
      throw new ConflictException('Este cliente no tiene una cuenta digital asociada');
    }

    const newPlainPassword = generateRandomPassword(6);
    const passwordHash = await bcrypt.hash(newPlainPassword, 10);
    await this.userRepository.update(client.userId, { passwordHash });

    return { initialDigitalPassword: newPlainPassword };
  }

  /**
   * Activa/desactiva el acceso del cliente al portal de autoservicio sin
   * afectar el registro comercial (contratos/facturas siguen intactos).
   */
  async setDigitalAccess(clientId: string, isActive: boolean): Promise<ClientEntity> {
    const client = await this.findById(clientId);
    if (!client.userId) {
      throw new ConflictException('Este cliente no tiene una cuenta digital asociada');
    }

    await this.userRepository.update(client.userId, { isActive });
    return this.findById(clientId);
  }

  async update(id: string, dto: UpdateClientDto): Promise<ClientEntity> {
    const client = await this.findById(id);

    if (dto.docNumber && dto.docNumber !== client.docNumber) {
      const existing = await this.clientRepository.findOne({ where: { docNumber: dto.docNumber } });
      if (existing && existing.id !== id) {
        throw new ConflictException(`Ya existe un cliente con el documento ${dto.docNumber}`);
      }
    }

    Object.assign(client, dto);
    const saved = await this.clientRepository.save(client);

    if (dto.email && saved.userId) {
      await this.userRepository.update(saved.userId, { email: dto.email.toLowerCase() });
    }

    return saved;
  }

  /**
   * Genera un enlace de un solo uso (24h) para que el cliente comparta su
   * ubicación GPS real desde su propio celular — no depende de que el agente
   * de oficina esté físicamente en la dirección del cliente. Intenta enviarlo
   * por WhatsApp automáticamente; si falla (sesión no conectada, etc.) igual
   * devuelve el enlace para que la oficina lo copie y lo envíe manualmente.
   */
  async requestGpsLocation(
    clientId: string,
    addressId: string,
    requestedByUserId?: string,
  ): Promise<{ token: string; link: string; expiresAt: Date; whatsappSent: boolean }> {
    const client = await this.findById(clientId);
    const address = client.addresses?.find((a) => a.id === addressId);
    if (!address) {
      throw new NotFoundException(`Dirección ${addressId} no encontrada para el cliente ${clientId}`);
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const gpsRequest = this.gpsRequestRepository.create({
      addressId,
      token,
      status: 'PENDING',
      expiresAt,
      requestedByUserId,
    });
    await this.gpsRequestRepository.save(gpsRequest);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const link = `${frontendUrl}/ubicacion/${token}`;

    const message = `Hola ${client.name}, para completar tu instalación necesitamos tu ubicación GPS. Por favor comparte tu ubicación abriendo este enlace desde tu celular: ${link}\n\nEste enlace vence en 24 horas.`;
    const whatsappSent = await this.aiChatbotClient.sendWhatsAppMessage(client.phone, message);

    return { token, link, expiresAt, whatsappSent };
  }

  private async findActivePlanOrFail(planId: string): Promise<PlanEntity> {
    const plan = await this.planRepository.findOneBy({ id: planId });
    if (!plan) {
      throw new NotFoundException(`Plan con ID ${planId} no encontrado`);
    }
    if (!plan.isActive) {
      throw new ConflictException(`El plan "${plan.name}" no está activo y no puede asignarse a un contrato`);
    }
    return plan;
  }

  /**
   * El contrato nace ACTIVE (no PENDING_INSTALL): la empresa moviliza recursos
   * (despacho de técnico, reserva de equipo) desde el momento de la firma, así
   * que la facturación recurrente arranca desde ahí también, sin esperar a que
   * se complete la instalación física (decisión de negocio confirmada 2026-09-08).
   * Emite CONTRACT_CREATED para que TicketsService genere automáticamente la
   * orden de instalación (ver ContractCreatedListener) — antes esto no ocurría
   * nunca, ni siquiera cuando el contrato nacía PENDING_INSTALL.
   */
  async addContract(clientId: string, planId: string, addressId: string, billingDay?: number): Promise<ContractEntity> {
    const client = await this.findById(clientId);
    await this.findActivePlanOrFail(planId);
    const contractNumber = `CTR-${Date.now().toString().slice(-6)}`;

    const contract = this.contractRepository.create({
      contractNumber,
      clientId: client.id,
      planId,
      addressId,
      startDate: new Date().toISOString().split('T')[0],
      billingDay: billingDay && billingDay >= 1 && billingDay <= 31 ? billingDay : 15,
      status: 'ACTIVE',
    });

    const saved = await this.contractRepository.save(contract);

    const event: ContractCreatedEvent = {
      contractId: saved.id,
      clientId: saved.clientId,
      contractNumber: saved.contractNumber,
      occurredOn: new Date(),
    };
    this.eventEmitter.emit(SystemEvents.CONTRACT_CREATED, event);

    return saved;
  }

  async findContractsByClientId(clientId: string): Promise<ContractEntity[]> {
    const client = await this.findById(clientId);
    return client.contracts || [];
  }

  async findAllContracts(dto: FindContractsDto) {
    const page = dto.page || 1;
    const limit = dto.limit || 15;
    const skip = (page - 1) * limit;

    const query = this.contractRepository
      .createQueryBuilder('contract')
      .leftJoinAndSelect('contract.client', 'client')
      .leftJoinAndSelect('contract.plan', 'plan')
      .leftJoinAndSelect('contract.address', 'address')
      .orderBy('contract.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    if (dto.status) {
      query.andWhere('contract.status = :status', { status: dto.status });
    }
    if (dto.search) {
      query.andWhere(
        '(client.name ILIKE :search OR client.docNumber ILIKE :search OR contract.contractNumber ILIKE :search)',
        { search: `%${dto.search}%` },
      );
    }

    const [data, total] = await query.getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  private async findContractOrFail(clientId: string, contractId: string): Promise<ContractEntity> {
    const contract = await this.contractRepository.findOne({ where: { id: contractId, clientId } });
    if (!contract) {
      throw new NotFoundException(`Contrato ${contractId} no encontrado para el cliente ${clientId}`);
    }
    return contract;
  }

  async updateContract(clientId: string, contractId: string, dto: UpdateContractDto): Promise<ContractEntity> {
    const contract = await this.findContractOrFail(clientId, contractId);
    if (dto.planId) {
      await this.findActivePlanOrFail(dto.planId);
      contract.planId = dto.planId;
    }
    if (dto.addressId) {
      contract.addressId = dto.addressId;
    }
    if (dto.billingDay) {
      contract.billingDay = dto.billingDay;
    }
    return this.contractRepository.save(contract);
  }

  async suspendContract(clientId: string, contractId: string): Promise<ContractEntity> {
    const contract = await this.findContractOrFail(clientId, contractId);
    if (contract.status !== 'ACTIVE') {
      throw new ConflictException(
        `Solo se pueden suspender contratos ACTIVE (estado actual: ${contract.status})`,
      );
    }
    contract.status = 'SUSPENDED';
    const saved = await this.contractRepository.save(contract);

    const event: ContractSuspendedEvent = {
      contractId: saved.id,
      clientId: saved.clientId,
      contractNumber: saved.contractNumber,
      daysOverdue: 0,
      occurredOn: new Date(),
    };
    this.eventEmitter.emit(SystemEvents.CONTRACT_SUSPENDED, event);

    return saved;
  }

  async reactivateContract(clientId: string, contractId: string): Promise<ContractEntity> {
    const contract = await this.findContractOrFail(clientId, contractId);
    if (contract.status !== 'SUSPENDED') {
      throw new ConflictException(
        `Solo se pueden reactivar contratos SUSPENDED (estado actual: ${contract.status})`,
      );
    }
    contract.status = 'ACTIVE';
    const saved = await this.contractRepository.save(contract);

    const event: ContractReactivatedEvent = {
      contractId: saved.id,
      clientId: saved.clientId,
      contractNumber: saved.contractNumber,
      occurredOn: new Date(),
    };
    this.eventEmitter.emit(SystemEvents.CONTRACT_REACTIVATED, event);

    return saved;
  }

  async terminateContract(clientId: string, contractId: string): Promise<ContractEntity> {
    const contract = await this.findContractOrFail(clientId, contractId);
    if (contract.status === 'TERMINATED') {
      throw new ConflictException(`El contrato ${contract.contractNumber} ya está terminado`);
    }
    contract.status = 'TERMINATED';
    contract.endDate = new Date().toISOString().split('T')[0];
    const saved = await this.contractRepository.save(contract);

    const event: ContractTerminatedEvent = {
      contractId: saved.id,
      clientId: saved.clientId,
      contractNumber: saved.contractNumber,
      occurredOn: new Date(),
    };
    this.eventEmitter.emit(SystemEvents.CONTRACT_TERMINATED, event);

    return saved;
  }

  /**
   * PDF de contrato de servicios (constancia + cláusulas placeholder, ver
   * PrintingModule) para entregar o enviar al cliente al momento de la firma.
   */
  async generateContractPdf(clientId: string, contractId: string): Promise<Buffer> {
    const contract = await this.contractRepository.findOne({
      where: { id: contractId, clientId },
      relations: ['client', 'plan', 'address'],
    });
    if (!contract) {
      throw new NotFoundException(`Contrato ${contractId} no encontrado para el cliente ${clientId}`);
    }

    let company: {
      rnc: string;
      razonSocial: string;
      nombreComercial?: string;
      direccion?: string;
      telefono?: string;
      correo?: string;
    };

    if (this.companyService) {
      const fiscal = await this.companyService.getCompanyFiscalInfo();
      company = {
        rnc: fiscal.rnc,
        razonSocial: fiscal.razonSocial,
        nombreComercial: fiscal.nombreComercial,
        direccion: fiscal.direccion,
        telefono: fiscal.telefono,
        correo: fiscal.correo,
      };
    } else {
      const config = this.dgiiClient.getConfig();
      company = {
        rnc: config.rncEmisor,
        razonSocial: config.razonSocialEmisor,
        nombreComercial: config.nombreComercial,
        direccion: config.direccionEmisor,
        telefono: config.telefonoEmisor,
        correo: config.correoEmisor,
      };
    }

    // Ninguna de las dos firmas es obligatoria para poder imprimir el
    // contrato (decisión de negocio: la firma electrónica es opcional por
    // ahora) — getLatestBufferForPdf nunca lanza, así que un fallo de MinIO
    // al leer la imagen degrada a "sin firma" en vez de romper la descarga.
    const [clientSignature, companySignature] = await Promise.all([
      this.contractSignatures.getLatestBufferForPdf(contractId, 'CLIENT'),
      this.contractSignatures.getLatestBufferForPdf(contractId, 'COMPANY'),
    ]);

    return this.pdfGenerator.generateContractPdf({
      company,
      contract: {
        contractNumber: contract.contractNumber,
        status: contract.status,
        startDate: contract.startDate,
        endDate: contract.endDate,
        billingDay: contract.billingDay,
      },
      client: {
        name: contract.client.name,
        docType: contract.client.docType,
        docNumber: contract.client.docNumber,
        email: contract.client.email,
        phone: contract.client.phone,
      },
      plan: {
        name: contract.plan.name,
        serviceType: contract.plan.serviceType,
        speedMbps: contract.plan.speedMbps,
        tvChannelsCount: contract.plan.tvChannelsCount,
        monthlyPrice: Number(contract.plan.monthlyPrice),
      },
      address: {
        street: contract.address.street,
        buildingNumber: contract.address.buildingNumber,
        sector: contract.address.sector,
        municipality: contract.address.municipality,
        city: contract.address.city,
      },
      signatures: {
        client: clientSignature
          ? { imageBuffer: clientSignature.buffer, signedByName: clientSignature.signedByName, signedAt: clientSignature.signedAt }
          : undefined,
        company: companySignature
          ? { imageBuffer: companySignature.buffer, signedByName: companySignature.signedByName, signedAt: companySignature.signedAt }
          : undefined,
      },
    });
  }

  async getClientInvoices(clientId: string, status?: string): Promise<InvoiceEntity[]> {
    await this.findById(clientId);
    const where: FindOptionsWhere<InvoiceEntity> = { clientId };
    if (status) {
      where.status = status as InvoiceEntity['status'];
    }
    return this.invoiceRepository.find({
      where,
      relations: ['contract', 'contract.plan'],
      order: { issuedAt: 'DESC' },
    });
  }
}
