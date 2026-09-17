import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Historial auditable de cada ejecución de certificación (Set de Pruebas,
 * Simulación Paso 4, ACECF) — antes de esto, cada corrida vivía solo en
 * memoria y se perdía al recargar la pantalla; no había forma de probar que
 * un caso específico fue realmente aceptado por la DGII, ni de encadenar
 * notas de crédito/débito contra el e-CF base que sí se aceptó.
 */
@Entity('dgii_certification_runs')
export class DgiiCertificationRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'run_source', type: 'varchar', length: 20 })
  runSource: 'TEST_CASE' | 'RUN_ALL' | 'SIMULATION';

  @Column({ name: 'caso_numero', type: 'int', nullable: true })
  casoNumero?: number;

  @Column({ name: 'nombre_caso', type: 'varchar', length: 255, nullable: true })
  nombreCaso?: string;

  @Column({ name: 'tipo_ecf', type: 'varchar', length: 3 })
  tipoEcf: string;

  // true = se envió como Resumen de Factura de Consumo (RFCE, endpoint/host
  // distinto de fc.dgii.gov.do) en vez de como e-CF individual — el e-CF base
  // (tipo_ecf) sigue siendo '32', esto solo distingue el canal de envío.
  @Column({ name: 'es_rfce', type: 'boolean', default: false })
  esRfce: boolean;

  @Index()
  @Column({ name: 'e_ncf', type: 'varchar', length: 13 })
  eNcf: string;

  @Column({ name: 'e_ncf_modificado', type: 'varchar', length: 13, nullable: true })
  eNcfModificado?: string;

  @Column({ name: 'rnc_comprador', type: 'varchar', length: 11, nullable: true })
  rncComprador?: string;

  @Column({ name: 'razon_social_comprador', type: 'varchar', length: 255, nullable: true })
  razonSocialComprador?: string;

  @Column({ name: 'monto_total', type: 'decimal', precision: 14, scale: 2, default: 0 })
  montoTotal: number;

  @Index()
  @Column({ name: 'status', type: 'varchar', length: 20 })
  status: 'PENDING' | 'ACCEPTED' | 'CONTINGENCY' | 'REJECTED' | 'ERROR';

  @Column({ name: 'track_id', type: 'varchar', length: 100, nullable: true })
  trackId?: string;

  @Column({ name: 'security_code', type: 'varchar', length: 20, nullable: true })
  securityCode?: string;

  @Column({ name: 'response_message', type: 'text', nullable: true })
  responseMessage?: string;

  @Column({ name: 'validation_errors', type: 'jsonb', nullable: true })
  validationErrors?: string[];

  @Column({ name: 'signed_xml', type: 'text', nullable: true })
  signedXml?: string;

  @Column({ name: 'environment', type: 'varchar', length: 20 })
  environment: string;

  @CreateDateColumn({ name: 'executed_at' })
  executedAt: Date;
}
