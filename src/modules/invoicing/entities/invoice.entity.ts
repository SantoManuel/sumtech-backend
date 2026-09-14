import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { SaleEntity } from '../../pos/entities/sale.entity';
import { ClientEntity } from '../../clients/entities/client.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';

@Entity({ schema: 'pos', name: 'invoices' })
export class InvoiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Nula mientras la factura está PENDING_PAYMENT (recurrente, aún sin cobrar).
  // Se asigna al liquidarse, junto con el NCF (ver InvoicingService.settleInvoice).
  @Column({ name: 'sale_id', type: 'uuid', unique: true, nullable: true })
  saleId?: string;

  @OneToOne(() => SaleEntity, (sale) => sale.invoice, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'sale_id' })
  sale?: SaleEntity;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @ManyToOne(() => ClientEntity, (client) => client.invoices)
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ name: 'contract_id', type: 'uuid', nullable: true })
  contractId?: string;

  @ManyToOne(() => ContractEntity, (contract) => contract.invoices, { nullable: true })
  @JoinColumn({ name: 'contract_id' })
  contract?: ContractEntity;

  @Column({
    type: 'enum',
    enum: ['PENDING_PAYMENT', 'ISSUED', 'VOIDED'],
    default: 'ISSUED',
  })
  status: 'PENDING_PAYMENT' | 'ISSUED' | 'VOIDED';

  // Nulos mientras status = PENDING_PAYMENT; se asignan solo al timbrar ante la DGII.
  @Column({ name: 'ncf_number', type: 'varchar', length: 20, unique: true, nullable: true })
  ncfNumber?: string;

  @Column({
    name: 'ncf_type',
    type: 'enum',
    enum: ['E31', 'E32', 'E33', 'E34', 'E44', 'E45', 'B01', 'B02'],
    nullable: true,
  })
  ncfType?: 'E31' | 'E32' | 'E33' | 'E34' | 'E44' | 'E45' | 'B01' | 'B02';

  @Column({
    name: 'dgii_status',
    type: 'enum',
    enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'CONTINGENCY'],
    default: 'ACCEPTED',
  })
  dgiiStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CONTINGENCY';

  @Column({ name: 'dgii_track_id', type: 'varchar', length: 100, nullable: true })
  dgiiTrackId?: string;

  @Column({ name: 'security_code', type: 'varchar', length: 10, nullable: true })
  securityCode?: string;

  // Vencimiento de la secuencia de NCF autorizada (formato dd-MM-yyyy) vigente
  // al momento del timbrado — no es la fecha de cobro de la factura (dueDate).
  // Nulo para comprobantes que no llevan FechaVencimientoSecuencia (E32/E34).
  @Column({ name: 'ncf_expiry_date', type: 'varchar', length: 20, nullable: true })
  ncfExpiryDate?: string;

  @Column({ name: 'qr_code_content', type: 'text', nullable: true })
  qrCodeContent?: string;

  @Column({ name: 'signed_xml_url', type: 'varchar', length: 255, nullable: true })
  signedXmlUrl?: string;

  @Column({ name: 'signed_xml_content', type: 'text', nullable: true })
  signedXmlContent?: string;

  @Column({ name: 'response_message', type: 'text', nullable: true })
  responseMessage?: string;

  @Column({ name: 'contingency_mode', type: 'boolean', default: false })
  contingencyMode: boolean;

  @Column({ name: 'buyer_doc_type', type: 'varchar', length: 20, nullable: true })
  buyerDocType?: string;

  @Column({ name: 'buyer_doc_number', type: 'varchar', length: 30, nullable: true })
  buyerDocNumber?: string;

  @Column({ name: 'buyer_name', type: 'varchar', length: 200, nullable: true })
  buyerName?: string;

  @Column({ name: 'tax_summary', type: 'jsonb', nullable: true })
  taxSummary?: {
    montoGravadoTotal: number;
    montoGravadoI1: number;
    montoGravadoI2: number;
    montoExento: number;
    totalITBIS: number;
    totalITBIS1: number;
    montoTotal: number;
  };

  // Montos propios de la factura: permiten que exista (PENDING_PAYMENT) antes de
  // que haya una Sale asociada. Para facturas ya emitidas vía POS ad-hoc, se
  // mantienen en sincronía con los montos de `sale`.
  @Column({ name: 'subtotal', type: 'decimal', precision: 12, scale: 2, nullable: true })
  subtotal?: number;

  @Column({ name: 'itbis_total', type: 'decimal', precision: 12, scale: 2, nullable: true })
  itbisTotal?: number;

  @Column({ name: 'cdt_amount', type: 'decimal', precision: 12, scale: 2, default: 0 })
  cdtAmount: number;

  @Column({ name: 'grand_total', type: 'decimal', precision: 12, scale: 2, nullable: true })
  grandTotal?: number;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate?: string;

  @Column({ name: 'billing_period_start', type: 'date', nullable: true })
  billingPeriodStart?: string;

  @Column({ name: 'billing_period_end', type: 'date', nullable: true })
  billingPeriodEnd?: string;

  @Column({ type: 'text', nullable: true })
  concept?: string;

  // Momento en que la factura fue efectivamente cobrada (distinto de issuedAt,
  // que marca cuándo se creó el registro de la factura/receivable).
  @Column({ name: 'paid_at', type: 'timestamp with time zone', nullable: true })
  paidAt?: Date;

  // Evitan reenviar el mismo recordatorio en corridas sucesivas del cron de morosidad.
  @Column({ name: 'advance_reminder_sent_at', type: 'timestamp with time zone', nullable: true })
  advanceReminderSentAt?: Date;

  @Column({ name: 'overdue_reminder_sent_at', type: 'timestamp with time zone', nullable: true })
  overdueReminderSentAt?: Date;

  // Solo poblados en la fila de una Nota de Crédito (ncfType E34): la factura
  // ISSUED original que esta fila anula, y los datos de InformacionReferencia
  // ya persistidos (además de ir embebidos en el XML firmado) para poder
  // mostrarlos/auditarlos sin tener que parsear signedXmlContent.
  @Column({ name: 'original_invoice_id', type: 'uuid', nullable: true })
  originalInvoiceId?: string;

  @ManyToOne(() => InvoiceEntity, { nullable: true })
  @JoinColumn({ name: 'original_invoice_id' })
  originalInvoice?: InvoiceEntity;

  // Lado inverso: la Nota de Crédito (si existe) que anula esta factura.
  @OneToOne(() => InvoiceEntity, (invoice) => invoice.originalInvoice)
  creditNote?: InvoiceEntity;

  @Column({ name: 'ncf_modificado', type: 'varchar', length: 20, nullable: true })
  ncfModificado?: string;

  @Column({ name: 'codigo_modificacion', type: 'varchar', length: 1, nullable: true })
  codigoModificacion?: '1' | '2' | '3' | '4' | '5';

  @Column({ name: 'razon_modificacion', type: 'varchar', length: 90, nullable: true })
  razonModificacion?: string;

  @CreateDateColumn({ name: 'issued_at', type: 'timestamp with time zone' })
  issuedAt: Date;
}
