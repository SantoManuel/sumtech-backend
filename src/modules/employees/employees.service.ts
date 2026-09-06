import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmployeeEntity } from './entities/employee.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(EmployeeEntity)
    private readonly employeeRepository: Repository<EmployeeEntity>,
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
    const existing = await this.employeeRepository.findOne({ where: { cedula: dto.cedula } });
    if (existing) {
      throw new ConflictException('Ya existe un empleado registrado con esta cédula');
    }

    const employee = this.employeeRepository.create(dto);
    return this.employeeRepository.save(employee);
  }

  async update(id: string, dto: UpdateEmployeeDto): Promise<EmployeeEntity> {
    const employee = await this.findById(id);
    Object.assign(employee, dto);
    return this.employeeRepository.save(employee);
  }
}
