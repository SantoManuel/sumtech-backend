import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { OltPartialOperationEntity } from '../entities/olt-partial-operation.entity';
import { OltPartialOperationService } from './olt-partial-operation.service';

describe('OltPartialOperationService', () => {
  const builder = { update: jest.fn(), set: jest.fn(), where: jest.fn(), execute: jest.fn() };
  const repo = { create: jest.fn(), save: jest.fn(), find: jest.fn(), createQueryBuilder: jest.fn() };
  let service: OltPartialOperationService;

  beforeEach(() => {
    jest.resetAllMocks();
    builder.update.mockReturnValue(builder);
    builder.set.mockReturnValue(builder);
    builder.where.mockReturnValue(builder);
    builder.execute.mockResolvedValue({ affected: 1 });
    repo.createQueryBuilder.mockReturnValue(builder);
    repo.create.mockImplementation((value) => value);
    repo.save.mockImplementation(async (value) => value);
    service = new OltPartialOperationService(repo as unknown as Repository<OltPartialOperationEntity>);
  });

  it('persists identifiers and the expected state', async () => {
    const input = { oltId: 'olt', operation: 'authorize', resourceKey: '1/1/1:2', expectedState: 'PRESENT' as const };
    await expect(service.record(input)).resolves.toEqual({ ...input, onuId: null });
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('rejects command-like resource keys', async () => {
    await expect(service.record({ oltId: 'olt', operation: 'x', resourceKey: 'password secret', expectedState: 'PRESENT' })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('limits pending scans', async () => {
    await service.listPending(10);
    expect(repo.find).toHaveBeenCalledWith({ where: { status: 'PENDING' }, order: { createdAt: 'ASC', id: 'ASC' }, take: 10 });
    await expect(service.listPending(501)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['PRESENT', 'ABSENT', 'UNKNOWN'] as const)('records %s with an atomic pending-only comparison', async (observed) => {
    await expect(service.reconcile('id', observed)).resolves.toBe(true);
    expect(builder.where).toHaveBeenCalledWith('id = :id AND status = :pending', { id: 'id', pending: 'PENDING', observed });
    const update = builder.set.mock.calls[0][0];
    expect(update.status()).toContain("expected_state = :observed");
    expect(update.reconciledAt()).toContain('CURRENT_TIMESTAMP');
  });

  it('does not reopen or overwrite a closed operation', async () => {
    builder.execute.mockResolvedValue({ affected: 0 });
    await expect(service.reconcile('id', 'PRESENT')).resolves.toBe(false);
  });

  it('rejects invalid observations', async () => {
    await expect(service.reconcile('id', 'INVALID' as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });
});
