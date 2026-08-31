import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('dgii_received_invoices')
export class DgiiReceivedInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'rnc_emisor', type: 'varchar', length: 11 })
  rncEmisor: string;

  @Column({ name: 'razon_social_emisor', type: 'varchar', length: 255, nullable: true })
  razonSocialEmisor?: string;

  @Index()
  @Column({ name: 'rnc_comprador', type: 'varchar', length: 11 })
  rncComprador: string;

  @Index()
  @Column({ name: 'encf', type: 'varchar', length: 13 })
  eNcf: string;

  @Column({ name: 'tipo_ecf', type: 'varchar', length: 2 })
  tipoEcf: string;

  @Column({ name: 'monto_total', type: 'decimal', precision: 14, scale: 2, default: 0 })
  montoTotal: number;

  @Column({ name: 'monto_exento', type: 'decimal', precision: 14, scale: 2, default: 0 })
  montoExento: number;

  @Column({ name: 'total_itbis', type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalItbis: number;

  @Column({ name: 'estado_acuse', type: 'smallint', default: 0 }) // 0 = Aceptado, 1 = Rechazado
  estadoAcuse: number;

  @Column({ name: 'motivo_rechazo', type: 'text', nullable: true })
  motivoRechazo?: string;

  @Column({ name: 'estado_aprobacion_comercial', type: 'smallint', default: 0 }) // 0 = Pendiente, 1 = Aprobado, 2 = Rechazado
  estadoAprobacionComercial: number;

  @Column({ name: 'xml_original', type: 'text' })
  xmlOriginal: string;

  @Column({ name: 'xml_signed_arecf', type: 'text' })
  xmlSignedArecf: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
