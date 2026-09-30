import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BranchEntity } from './entities/branch.entity';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@Injectable()
export class BranchesService {
  constructor(
    @InjectRepository(BranchEntity)
    private readonly branchRepository: Repository<BranchEntity>,
  ) {}

  async findAll(activeOnly = false): Promise<BranchEntity[]> {
    return this.branchRepository.find({
      where: activeOnly ? { isActive: true } : {},
      order: { name: 'ASC' },
    });
  }

  async findById(id: string): Promise<BranchEntity> {
    const branch = await this.branchRepository.findOne({ where: { id } });
    if (!branch) {
      throw new NotFoundException(`Sucursal con ID ${id} no encontrada`);
    }
    return branch;
  }

  async create(dto: CreateBranchDto): Promise<BranchEntity> {
    const branch = this.branchRepository.create(dto);
    return this.branchRepository.save(branch);
  }

  async update(id: string, dto: UpdateBranchDto): Promise<BranchEntity> {
    const branch = await this.findById(id);
    Object.assign(branch, dto);
    return this.branchRepository.save(branch);
  }
}
