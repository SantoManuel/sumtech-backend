import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { encryptSecret, decryptSecretSafe } from '../../../common/utils/secret-crypto.util';

/**
 * Configuración SMTP propia de ESTE tenant — una sola fila por DB de tenant,
 * mismo criterio de "singleton sin constraint de DB" que CompanyProfileEntity
 * (ver MailSettingsService.getSettings). Si `enabled=false` o no hay fila
 * creada todavía, MailService cae al transporte SMTP global configurado por
 * variables de entorno (MailModule) — un tenant nunca queda sin poder enviar
 * correo solo por no haber configurado el suyo propio.
 */
@Entity({ schema: 'sec', name: 'mail_settings' })
export class MailSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ name: 'smtp_host', type: 'varchar', length: 255, nullable: true })
  smtpHost?: string;

  @Column({ name: 'smtp_port', type: 'int', default: 587 })
  smtpPort: number;

  @Column({ name: 'smtp_user', type: 'varchar', length: 255, nullable: true })
  smtpUser?: string;

  // Cifrado en reposo (AES-256-GCM) vía transformer de columna — mismo
  // mecanismo ya usado por CompanyProfileEntity.dgiiCertPassword. `text` en
  // vez de `varchar` porque el ciphertext+IV+authTag en base64 es más largo
  // que la contraseña original.
  @Column({
    name: 'smtp_pass_enc',
    type: 'text',
    nullable: true,
    transformer: { to: encryptSecret, from: decryptSecretSafe },
  })
  smtpPass?: string;

  @Column({ name: 'smtp_secure', type: 'boolean', default: false })
  smtpSecure: boolean;

  @Column({ name: 'from_address', type: 'varchar', length: 255, nullable: true })
  fromAddress?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
