import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { ClientEntity } from './entities/client.entity';
import { AddressEntity } from './entities/address.entity';
import { ContractEntity } from './entities/contract.entity';
import { UserEntity } from '../users/entities/user.entity';
import { RoleEntity } from '../users/entities/role.entity';
import { Role } from '../../common/enums/role.enum';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

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

    const address = this.addressRepository.create({
      ...dto.address,
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

  async update(id: string, dto: UpdateClientDto): Promise<ClientEntity> {
    const client = await this.findById(id);
    Object.assign(client, dto);
    return this.clientRepository.save(client);
  }

  async addContract(clientId: string, planId: string, addressId: string): Promise<ContractEntity> {
    const client = await this.findById(clientId);
    const contractNumber = `CTR-${Date.now().toString().slice(-6)}`;

    const contract = this.contractRepository.create({
      contractNumber,
      clientId: client.id,
      planId,
      addressId,
      startDate: new Date().toISOString().split('T')[0],
      billingDay: 15,
      status: 'PENDING_INSTALL',
    });

    return this.contractRepository.save(contract);
  }

  async findContractsByClientId(clientId: string): Promise<ContractEntity[]> {
    const client = await this.findById(clientId);
    return client.contracts || [];
  }
}
