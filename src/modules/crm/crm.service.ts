import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeadEntity } from './entities/lead.entity';
import { InteractionEntity } from './entities/interaction.entity';
import { CreateLeadDto, CreateInteractionDto } from './dto/crm.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class CrmService {
  constructor(
    @InjectRepository(LeadEntity)
    private readonly leadRepository: Repository<LeadEntity>,
    @InjectRepository(InteractionEntity)
    private readonly interactionRepository: Repository<InteractionEntity>,
  ) {}

  async findAllLeads(paginationDto: PaginationDto, status?: string) {
    const page = paginationDto.page || 1;
    const limit = paginationDto.limit || 15;
    const skip = (page - 1) * limit;

    const query = this.leadRepository
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.plan', 'plan')
      .skip(skip)
      .take(limit)
      .orderBy('lead.createdAt', 'DESC');

    if (status) query.where('lead.status = :status', { status });

    const [data, total] = await query.getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async createLead(dto: CreateLeadDto): Promise<LeadEntity> {
    const lead = this.leadRepository.create({
      ...dto,
      source: dto.source || 'WEB_LANDING',
      status: 'NEW',
    });
    return this.leadRepository.save(lead);
  }

  async updateLeadStatus(id: string, status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'DISCARDED'): Promise<LeadEntity> {
    const lead = await this.leadRepository.findOneBy({ id });
    if (!lead) {
      throw new NotFoundException(`Lead con ID ${id} no encontrado`);
    }
    lead.status = status;
    return this.leadRepository.save(lead);
  }

  async findInteractionsByClient(clientId: string) {
    return this.interactionRepository.find({
      where: { clientId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  async createInteraction(userId: string, dto: CreateInteractionDto): Promise<InteractionEntity> {
    const interaction = this.interactionRepository.create({
      clientId: dto.clientId,
      userId,
      channel: dto.channel,
      subject: dto.subject,
      notes: dto.notes,
    });
    return this.interactionRepository.save(interaction);
  }

  async recordSaleInteraction(clientId: string, ncfNumber: string, grandTotal: number, userId?: string) {
    // Buscar un usuario del sistema o usar el que generó la venta
    const interaction = this.interactionRepository.create({
      clientId,
      userId: userId || '00000000-0000-0000-0000-000000000000',
      channel: 'SYSTEM_EVENT',
      subject: `Venta Confirmada - Factura ${ncfNumber}`,
      notes: `Compra realizada por un total de RD$ ${grandTotal.toLocaleString()}. Factura electrónica DGII ${ncfNumber} timbrada exitosamente.`,
    });
    return this.interactionRepository.save(interaction);
  }
}
