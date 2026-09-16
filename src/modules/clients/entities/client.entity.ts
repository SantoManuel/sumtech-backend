import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, OneToOne, JoinColumn } from 'typeorm';
import { AddressEntity } from './address.entity';
import { ContractEntity } from './contract.entity';
import { SaleEntity } from '../../pos/entities/sale.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';

@Entity({ schema: 'com', name: 'clients' })
export class ClientEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_type', type: 'enum', enum: ['FISICA', 'JURIDICA'], default: 'FISICA' })
  clientType: 'FISICA' | 'JURIDICA';

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'doc_type', type: 'enum', enum: ['CEDULA', 'RNC', 'PASAPORTE'], default: 'CEDULA' })
  docType: 'CEDULA' | 'RNC' | 'PASAPORTE';

  @Column({ name: 'doc_number', type: 'varchar', length: 30, unique: true })
  docNumber: string;

  @Column({ type: 'varchar', length: 100 })
  email: string;

  @Column({ type: 'varchar', length: 20 })
  phone: string;

  @Column({ name: 'alt_phone', type: 'varchar', length: 20, nullable: true })
  altPhone?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'user_id', type: 'uuid', nullable: true, unique: true })
  userId?: string;

  /**
   * Contraseña del Portal de Autoservicio en texto plano — SOLO hasta que se
   * imprime el primer contrato del cliente (ClientsService.generateContractPdf
   * la embebe en el PDF y la limpia a NULL en la misma operación). Nunca se
   * selecciona por defecto (select: false, igual que UserEntity.passwordHash)
   * para que no aparezca en ningún GET de cliente por accidente.
   */
  @Column({ name: 'pending_portal_password', type: 'varchar', length: 20, nullable: true, select: false })
  pendingPortalPassword?: string | null;

  @OneToOne(() => UserEntity, (user) => user.client, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @OneToMany(() => AddressEntity, (address) => address.client, { cascade: true })
  addresses: AddressEntity[];

  @OneToMany(() => ContractEntity, (contract) => contract.client)
  contracts: ContractEntity[];

  @OneToMany(() => SaleEntity, (sale) => sale.client)
  sales?: SaleEntity[];

  @OneToMany(() => InvoiceEntity, (invoice) => invoice.client)
  invoices?: InvoiceEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
