import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type SignatureParty = 'CLIENT' | 'COMPANY';
export type SignatureMethod = 'DRAW' | 'TYPE' | 'UPLOAD';
export type SignatureCapturedByRole = 'STAFF' | 'TECNICO';

/**
 * Registro inmutable de una firma electrónica capturada sobre un contrato
 * (cliente o representante de Sumtech) — en oficina o en calle vía el
 * técnico durante la instalación. Nunca se hace UPDATE/DELETE desde la app:
 * si hay que corregir una firma, se inserta una fila nueva y la vigente pasa
 * a ser la de mayor `signedAt` para esa (contractId, party) — ver
 * ContractSignaturesService.getLatestByParty(). Esto preserva la evidencia
 * original (relevante para la validez de la firma bajo la Ley 126-02 de
 * Comercio Electrónico y Firmas Digitales de RD).
 */
@Entity({ schema: 'com', name: 'contract_signatures' })
export class ContractSignatureEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contract_id', type: 'uuid' })
  contractId: string;

  @Column({ type: 'enum', enum: ['CLIENT', 'COMPANY'] })
  party: SignatureParty;

  /** Object key en MinIO (bucket privado) — la imagen nunca se sirve por ruta pública. */
  @Column({ name: 'signature_file_key', type: 'varchar', length: 500 })
  signatureFileKey: string;

  @Column({ name: 'signed_by_name', type: 'varchar', length: 150 })
  signedByName: string;

  @Column({ type: 'enum', enum: ['DRAW', 'TYPE', 'UPLOAD'] })
  method: SignatureMethod;

  @Column({ name: 'signed_at', type: 'timestamp with time zone', default: () => 'NOW()' })
  signedAt: Date;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress?: string | null;

  @Column({ name: 'captured_by_user_id', type: 'uuid' })
  capturedByUserId: string;

  @Column({ name: 'captured_by_role', type: 'enum', enum: ['STAFF', 'TECNICO'] })
  capturedByRole: SignatureCapturedByRole;

  /** Solo se completa cuando la captura ocurrió en calle (técnico) — reutiliza la misma precisión que AddressEntity.gpsLatitude/gpsLongitude. */
  @Column({ name: 'gps_latitude', type: 'decimal', precision: 10, scale: 7, nullable: true })
  gpsLatitude?: number | null;

  @Column({ name: 'gps_longitude', type: 'decimal', precision: 10, scale: 7, nullable: true })
  gpsLongitude?: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
