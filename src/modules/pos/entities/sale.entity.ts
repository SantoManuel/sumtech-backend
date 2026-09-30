import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  ManyToOne, 
  JoinColumn, 
  OneToMany, 
  OneToOne, 
  CreateDateColumn 
} from 'typeorm';
import { ClientEntity } from '../../clients/entities/client.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { CashRegisterEntity } from './cash-register.entity';
import { SaleDetailEntity } from './sale-detail.entity';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';

@Entity({ schema: 'pos', name: 'sales' })
export class SaleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'cash_register_id', type: 'uuid', nullable: true })
  cashRegisterId?: string;

  @ManyToOne(() => CashRegisterEntity, (cr) => cr.sales, { nullable: true })
  @JoinColumn({ name: 'cash_register_id' })
  cashRegister?: CashRegisterEntity;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @ManyToOne(() => ClientEntity, (client) => client.sales)
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ name: 'contract_id', type: 'uuid', nullable: true })
  contractId?: string;

  @ManyToOne(() => ContractEntity, { nullable: true })
  @JoinColumn({ name: 'contract_id' })
  contract?: ContractEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'billing_period', type: 'varchar', length: 50, nullable: true })
  billingPeriod?: string; // ej. "Septiembre 2026"

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate?: string; // ej. "2026-09-15"

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  subtotal: number;

  @Column({ name: 'discount_amount', type: 'decimal', precision: 12, scale: 2, default: 0.00 })
  discountAmount: number;

  @Column({
    name: 'discount_type',
    type: 'varchar',
    length: 20,
    default: 'FIXED',
  })
  discountType: 'FIXED' | 'PERCENTAGE';

  @Column({
    name: 'discount_percentage',
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  discountPercentage?: number;

  @Column({ name: 'discount_reason', type: 'text', nullable: true })
  discountReason?: string;

  @Column({ name: 'discount_authorized_by', type: 'uuid', nullable: true })
  discountAuthorizedById?: string;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'discount_authorized_by' })
  discountAuthorizedBy?: UserEntity;

  @Column({ name: 'itbis_total', type: 'decimal', precision: 12, scale: 2 })
  itbisTotal: number;

  @Column({ name: 'grand_total', type: 'decimal', precision: 12, scale: 2 })
  grandTotal: number;

  @Column({ 
    name: 'payment_method', 
    type: 'enum', 
    enum: ['CASH', 'CARD_DEBIT', 'CARD_CREDIT', 'BANK_TRANSFER', 'MIXED'], 
    default: 'CASH' 
  })
  paymentMethod: 'CASH' | 'CARD_DEBIT' | 'CARD_CREDIT' | 'BANK_TRANSFER' | 'MIXED';

  @Column({ type: 'enum', enum: ['PENDING', 'PAID', 'CANCELLED'], default: 'PAID' })
  status: 'PENDING' | 'PAID' | 'CANCELLED';

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @OneToMany(() => SaleDetailEntity, (detail) => detail.sale, { cascade: true })
  details: SaleDetailEntity[];

  @OneToOne(() => InvoiceEntity, (invoice) => invoice.sale, { cascade: true })
  invoice?: InvoiceEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
