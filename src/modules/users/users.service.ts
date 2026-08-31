import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UserEntity } from './entities/user.entity';
import { RoleEntity } from './entities/role.entity';
import { AuditLogEntity } from './entities/audit-log.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
  ) {}

  async findAll(paginationDto: PaginationDto) {
    const page = paginationDto.page || 1;
    const limit = paginationDto.limit || 10;
    const skip = (page - 1) * limit;

    const [data, total] = await this.userRepository.findAndCount({
      relations: ['roles', 'employee'],
      skip,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string): Promise<UserEntity> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['roles', 'employee', 'client'],
    });
    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
    }
    return user;
  }

  async findByUsernameOrEmail(identifier: string): Promise<UserEntity | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .leftJoinAndSelect('user.roles', 'roles')
      .leftJoinAndSelect('user.employee', 'employee')
      .leftJoinAndSelect('user.client', 'client')
      .where('user.username = :identifier OR user.email = :identifier', { identifier })
      .getOne();
  }

  async create(dto: CreateUserDto): Promise<UserEntity> {
    const existing = await this.findByUsernameOrEmail(dto.username);
    if (existing) {
      throw new ConflictException('El nombre de usuario o correo ya está en uso');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const roles: RoleEntity[] = [];

    if (dto.roleIds && dto.roleIds.length > 0) {
      for (const roleId of dto.roleIds) {
        const role = await this.roleRepository.findOneBy({ id: roleId });
        if (role) roles.push(role);
      }
    }

    const user = this.userRepository.create({
      username: dto.username,
      email: dto.email,
      passwordHash,
      roles,
      isActive: true,
    });

    const savedUser = await this.userRepository.save(user);

    await this.auditLogRepository.save(
      this.auditLogRepository.create({
        userId: savedUser.id,
        action: 'CREATE_USER',
        entity: 'User',
        entityId: savedUser.id,
      }),
    );

    return this.findById(savedUser.id);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    const user = await this.findById(id);
    if (dto.email) user.email = dto.email;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;

    if (dto.roleIds) {
      const roles: RoleEntity[] = [];
      for (const roleId of dto.roleIds) {
        const role = await this.roleRepository.findOneBy({ id: roleId });
        if (role) roles.push(role);
      }
      user.roles = roles;
    }

    await this.userRepository.save(user);
    return this.findById(id);
  }

  async changePassword(id: string, dto: ChangePasswordDto): Promise<{ message: string }> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepository.save(user);

    return { message: 'Contraseña actualizada con éxito' };
  }

  async softDelete(id: string): Promise<{ message: string }> {
    const user = await this.findById(id);
    user.isActive = false;
    await this.userRepository.save(user);
    return { message: 'Usuario desactivado' };
  }
}
