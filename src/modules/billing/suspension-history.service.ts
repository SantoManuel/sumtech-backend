import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SuspensionHistoryEntity } from './entities/suspension-history.entity';

export interface OpenSuspensionInput {
  contractId: string;
  clientId: string;
  reason: string;
  relatedInvoiceId?: string;
  triggeredByUserId?: string;
  triggeredByProcess?: 'CRON_MOROSIDAD' | 'MANUAL';
  observation?: string;
}

export interface CloseSuspensionInput {
  reconnectedByUserId?: string;
  reconnectionFeeInvoiceId?: string;
}

/**
 * Historial persistente de suspensión/reconexión por contrato (sección 14-15
 * del spec de facturación) — antes la suspensión solo vivía como un evento
 * efímero (ContractSuspendedEvent), sin ningún rastro consultable después de
 * procesarse. Un episodio se abre al suspender y se cierra al reconectar.
 */
@Injectable()
export class SuspensionHistoryService {
  private readonly logger = new Logger(SuspensionHistoryService.name);

  constructor(
    @InjectRepository(SuspensionHistoryEntity)
    private readonly repository: Repository<SuspensionHistoryEntity>,
  ) {}

  async openSuspension(input: OpenSuspensionInput): Promise<SuspensionHistoryEntity> {
    const entry = this.repository.create({
      contractId: input.contractId,
      clientId: input.clientId,
      suspendedAt: new Date(),
      reason: input.reason,
      relatedInvoiceId: input.relatedInvoiceId,
      triggeredByUserId: input.triggeredByUserId,
      triggeredByProcess: input.triggeredByProcess,
      observation: input.observation,
    });
    return this.repository.save(entry);
  }

  /**
   * Cierra la suspensión vigente (reconnectedAt IS NULL) más reciente del
   * contrato. No-op defensivo (con log) si no hay ninguna abierta — no debería
   * ocurrir en operación normal, pero no debe romper el flujo de reactivación
   * que lo invoca.
   */
  async closeSuspension(contractId: string, input: CloseSuspensionInput = {}): Promise<SuspensionHistoryEntity | null> {
    const open = await this.repository.findOne({
      where: { contractId, reconnectedAt: IsNull() },
      order: { suspendedAt: 'DESC' },
    });

    if (!open) {
      this.logger.warn(
        `No se encontró una suspensión abierta para el contrato ${contractId} al intentar cerrarla — se omite.`,
      );
      return null;
    }

    open.reconnectedAt = new Date();
    open.reconnectedByUserId = input.reconnectedByUserId;
    open.reconnectionFeeInvoiceId = input.reconnectionFeeInvoiceId;
    return this.repository.save(open);
  }

  async findHistoryForClient(clientId: string): Promise<SuspensionHistoryEntity[]> {
    return this.repository.find({
      where: { clientId },
      relations: ['relatedInvoice', 'triggeredByUser', 'reconnectedByUser', 'reconnectionFeeInvoice'],
      order: { suspendedAt: 'DESC' },
    });
  }
}
