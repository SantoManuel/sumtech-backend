import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { SaleEntity } from '../../pos/entities/sale.entity';

@Entity({ schema: 'pos', name: 'invoices' })
export class InvoiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sale_id', type: 'uuid', unique: true })
  saleId: string;

  @OneToOne(() => SaleEntity, (sale) => sale.invoice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sale_id' })
  sale: SaleEntity;

  @Column({ name: 'ncf_number', type: 'varchar', length: 20, unique: true })
  ncfNumber: string; // ej. E3100000001, E3200000005, B0100000012

  @Column({ 
    name: 'ncf_type', 
    type: 'enum', 
    enum: ['E31', 'E32', 'E33', 'E34', 'E44', 'E45', 'B01', 'B02'], 
    default: 'E31' 
  })
  ncfType: 'E31' | 'E32' | 'E33' | 'E34' | 'E44' | 'E45' | 'B01' | 'B02';

  @Column({ 
    name: 'dgii_status', 
    type: 'enum', 
    enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'CONTINGENCY'], 
    default: 'ACCEPTED' 
  })
  dgiiStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CONTINGENCY';

  @Column({ name: 'dgii_track_id', type: 'varchar', length: 100, nullable: true })
  dgiiTrackId?: string;

  @Column({ name: 'security_code', type: 'varchar', length: 10, nullable: true })
  securityCode?: string;

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

  @CreateDateColumn({ name: 'issued_at', type: 'timestamp with time zone' })
  issuedAt: Date;
}
