import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EmployeeEntity } from './entities/employee.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { UsersService } from '../users/users.service';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(EmployeeEntity)
    private readonly employeeRepository: Repository<EmployeeEntity>,
    private readonly usersService: UsersService,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(paginationDto: PaginationDto, roleFilter?: string) {
    const page = paginationDto.page || 1;
    const limit = paginationDto.limit || 10;
    const skip = (page - 1) * limit;

    const query = this.employeeRepository
      .createQueryBuilder('employee')
      .leftJoinAndSelect('employee.user', 'user')
      .leftJoinAndSelect('user.roles', 'roles')
      .skip(skip)
      .take(limit)
      .orderBy('employee.createdAt', 'DESC');

    if (roleFilter) {
      query.where('roles.name = :roleFilter', { roleFilter });
    }

    const [data, total] = await query.getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Ver comentario en el controller: directorio sin datos sensibles (sin salario). */
  async findDirectory(): Promise<{ id: string; jobTitle: string; user?: { username: string } }[]> {
    const employees = await this.employeeRepository.find({
      where: { isActive: true },
      relations: ['user'],
      order: { jobTitle: 'ASC' },
    });
    return employees.map((e) => ({
      id: e.id,
      jobTitle: e.jobTitle,
      user: e.user ? { username: e.user.username } : undefined,
    }));
  }

  async findById(id: string): Promise<EmployeeEntity> {
    const employee = await this.employeeRepository.findOne({
      where: { id },
      relations: ['user', 'user.roles'],
    });
    if (!employee) {
      throw new NotFoundException(`Empleado con ID ${id} no encontrado`);
    }
    return employee;
  }

  async create(dto: CreateEmployeeDto): Promise<EmployeeEntity> {
    if (dto.userId && dto.newUser) {
      throw new BadRequestException('Especifica un usuario existente (userId) o los datos de uno nuevo (newUser), no ambos');
    }

    const existing = await this.employeeRepository.findOne({ where: { cedula: dto.cedula } });
    if (existing) {
      throw new ConflictException('Ya existe un empleado registrado con esta cédula');
    }

    // Sin newUser: alta simple (con userId de un usuario ya existente, o sin
    // ninguno — colaborador sin acceso al sistema). No hace falta transacción.
    if (!dto.newUser) {
      const { newUser, ...employeeData } = dto;
      const employee = this.employeeRepository.create(employeeData);
      return this.employeeRepository.save(employee);
    }

    // Con newUser: crear el usuario y el perfil de empleado en una sola
    // transacción — si el perfil falla validarse, el usuario recién creado
    // también se revierte (nunca queda una cuenta huérfana sin empleado).
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const newUser = await this.usersService.create(dto.newUser, queryRunner.manager);

      const { newUser: _omit, ...employeeData } = dto;
      const employee = queryRunner.manager.getRepository(EmployeeEntity).create({
        ...employeeData,
        userId: newUser.id,
      });
      const savedEmployee = await queryRunner.manager.getRepository(EmployeeEntity).save(employee);

      await queryRunner.commitTransaction();
      return this.findById(savedEmployee.id);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Otorga acceso al sistema a un empleado que hoy no tiene usuario (ej. pasó
   * de conserjería a un puesto operativo). Misma atomicidad que create(): si
   * falla vincular el usuario al empleado, no queda una cuenta huérfana.
   */
  async grantAccess(employeeId: string, dto: CreateUserDto): Promise<EmployeeEntity> {
    const employee = await this.findById(employeeId);
    if (employee.userId) {
      throw new ConflictException('Este empleado ya tiene acceso al sistema');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const newUser = await this.usersService.create(dto, queryRunner.manager);

      employee.userId = newUser.id;
      await queryRunner.manager.getRepository(EmployeeEntity).save(employee);

      await queryRunner.commitTransaction();
      return this.findById(employeeId);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async update(id: string, dto: UpdateEmployeeDto): Promise<EmployeeEntity> {
    const employee = await this.findById(id);
    Object.assign(employee, dto);
    return this.employeeRepository.save(employee);
  }
}
