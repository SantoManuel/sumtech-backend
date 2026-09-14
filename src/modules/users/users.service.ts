import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, Not } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UserEntity } from './entities/user.entity';
import { RoleEntity } from './entities/role.entity';
import { AuditLogEntity } from './entities/audit-log.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { Role } from '../../common/enums/role.enum';

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

  /**
   * `manager` opcional: cuando se provee (ej. desde EmployeesService.create()
   * dentro de una transacción de alta de empleado con acceso al sistema), toda
   * la lectura/escritura corre sobre esa misma conexión transaccional en vez
   * del repositorio inyectado por defecto — así un fallo posterior (ej. cédula
   * duplicada al crear el perfil de empleado) revierte también este usuario,
   * sin dejar una cuenta huérfana.
   */
  async create(dto: CreateUserDto, manager?: EntityManager): Promise<UserEntity> {
    const userRepo = manager ? manager.getRepository(UserEntity) : this.userRepository;
    const roleRepo = manager ? manager.getRepository(RoleEntity) : this.roleRepository;
    const auditRepo = manager ? manager.getRepository(AuditLogEntity) : this.auditLogRepository;

    const existing = await userRepo
      .createQueryBuilder('user')
      .where('user.username = :username OR user.email = :email', { username: dto.username, email: dto.email })
      .getOne();
    if (existing) {
      throw new ConflictException('El nombre de usuario o correo ya está en uso');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const roles: RoleEntity[] = [];

    if (dto.roleIds && dto.roleIds.length > 0) {
      for (const roleId of dto.roleIds) {
        const role = await roleRepo.findOneBy({ id: roleId });
        if (role) roles.push(role);
      }
    }

    // El rol CLIENTE solo se asigna automáticamente vía ClientsService.create()
    // (RF-35, cuenta digital del portal de autoservicio) — ese flujo escribe el
    // usuario directamente por repositorio, sin pasar por este método. Cualquier
    // llamada a este create() (alta/otorgar-acceso de empleado, POST /users) con
    // CLIENTE es siempre un error de uso, nunca un caso de negocio válido.
    if (roles.some((role) => role.name === Role.CLIENTE)) {
      throw new BadRequestException('El rol CLIENTE no puede asignarse manualmente a un usuario; se genera automáticamente al crear el cliente.');
    }

    const user = userRepo.create({
      username: dto.username,
      email: dto.email,
      passwordHash,
      roles,
      isActive: true,
    });

    const savedUser = await userRepo.save(user);

    await auditRepo.save(
      auditRepo.create({
        userId: savedUser.id,
        action: 'CREATE_USER',
        entity: 'User',
        entityId: savedUser.id,
      }),
    );

    // Fuera de una transacción, se re-consulta con las relaciones completas
    // (employee/client) para la respuesta del endpoint standalone POST /users.
    // Dentro de una transacción no committeada, findById() consultaría por una
    // conexión distinta y no vería la fila todavía — se devuelve tal cual.
    return manager ? savedUser : this.findById(savedUser.id);
  }

  /**
   * `scope: 'staff'` excluye el rol CLIENTE — ese rol solo se asigna
   * automáticamente vía ClientsService.create() (RF-35), nunca manualmente
   * desde el módulo de Empleados/RRHH.
   */
  async findAllRoles(scope?: string): Promise<RoleEntity[]> {
    const where = scope === 'staff' ? { name: Not(Role.CLIENTE) } : {};
    return this.roleRepository.find({ where, order: { name: 'ASC' } });
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
