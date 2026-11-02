import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OltObservedState, OltPartialOperationEntity } from '../entities/olt-partial-operation.entity';

@Injectable()
export class OltPartialOperationService {
  constructor(
    @InjectRepository(OltPartialOperationEntity)
    private readonly operations: Repository<OltPartialOperationEntity>,
  ) {}

  // Only identifiers belong here: command output and provisioning payloads may contain secrets.
  async record(input: {
    oltId: string;
    onuId?: string;
    operation: string;
    resourceKey: string;
    expectedState: 'PRESENT' | 'ABSENT';
  }): Promise<OltPartialOperationEntity> {
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(input.operation) ||
        !/^[A-Za-z0-9_.:/-]{1,200}$/.test(input.resourceKey) ||
        !['PRESENT', 'ABSENT'].includes(input.expectedState)) {
      throw new BadRequestException('Invalid partial operation');
    }
    return this.operations.save(this.operations.create({ ...input, onuId: input.onuId ?? null }));
  }

  async listPending(limit = 100): Promise<OltPartialOperationEntity[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new BadRequestException('Invalid limit');
    }
    return this.operations.find({ where: { status: 'PENDING' }, order: { createdAt: 'ASC', id: 'ASC' }, take: limit });
  }

  // The caller must obtain a fresh, authoritative observation for this exact resource.
  async reconcile(id: string, observed: OltObservedState): Promise<boolean> {
    if (!['PRESENT', 'ABSENT', 'UNKNOWN'].includes(observed)) {
      throw new BadRequestException('Invalid observed state');
    }
    const result = await this.operations.createQueryBuilder()
      .update(OltPartialOperationEntity)
      .set({
        lastObservedState: observed,
        lastObservedAt: () => 'CURRENT_TIMESTAMP',
        status: () => `CASE WHEN expected_state = :observed THEN 'RECONCILED' ELSE 'PENDING' END`,
        reconciledAt: () => `CASE WHEN expected_state = :observed THEN CURRENT_TIMESTAMP ELSE NULL END`,
      })
      .where('id = :id AND status = :pending', { id, pending: 'PENDING', observed })
      .execute();
    return (result.affected ?? 0) > 0;
  }
}
