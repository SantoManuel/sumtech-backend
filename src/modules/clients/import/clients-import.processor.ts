import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import * as bcrypt from 'bcrypt';
import { ClientImportBatchEntity, LocationMappingTarget } from '../entities/client-import-batch.entity';
import { ClientImportRowErrorEntity } from '../entities/client-import-row-error.entity';
import { ClientEntity } from '../entities/client.entity';
import { AddressEntity } from '../entities/address.entity';
import { ContractEntity } from '../entities/contract.entity';
import { PlanEntity } from '../../plans/entities/plan.entity';
import { SectorEntity } from '../../geography/entities/sector.entity';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { RoleEntity } from '../../users/entities/role.entity';
import { Role } from '../../../common/enums/role.enum';
import { generateRandomPassword } from '../clients.service';
import { MinioStorageService } from '../../storage/minio-storage.service';
import { parseLegacyClientFile } from './legacy-client-parser';
import { LegacyClientRow } from './legacy-client-row.types';
import {
  buildLocationKey,
  inferDocType,
  mapEstadoToContractStatus,
  normalizeDocNumber,
  parseGpsCoordinates,
  parseInstallDate,
  parsePlanInternet,
  parseSaldo,
} from './legacy-field-mappers';
import { CLIENTS_IMPORT_QUEUE } from './clients-import.service';
import { buildCredentialsReportCsv, ImportedClientCredentials } from './credentials-report';

const CHUNK_SIZE = 300;
const SALDO_INICIAL_CONCEPT = 'Saldo Inicial (Migración Sistema Anterior)';
/**
 * El export legacy no trae columna de email, pero UserEntity.email es
 * UNIQUE — no se puede crear 3000 cuentas con email:''. Se genera uno
 * sintético por cliente, nunca visible/usado: el login del portal es por
 * username (cédula normalizada), no por este correo (ver AuthService).
 */
const SYNTHETIC_EMAIL_DOMAIN = 'clientes.sumtech.local';

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

type RowOutcome = 'created' | 'updated';

/**
 * Worker de BullMQ (concurrency 1: procesa un batch a la vez, secuencial por
 * lotes de CHUNK_SIZE filas — evita saturar Postgres con 20,000+ inserts
 * simultáneos). Una fila que falla se registra en client_import_row_errors y
 * NO aborta el resto del batch. No hay transacción por fila: si el contrato
 * falla después de guardar cliente+dirección, esos dos sí quedan creados (un
 * cliente sin contrato ya es un estado válido en el sistema — ver "Sin
 * Contrato" en el listado de clientes) y la fila igual se reporta como error
 * para que el admin revise el contrato manualmente.
 */
@Processor(CLIENTS_IMPORT_QUEUE, { concurrency: 1 })
export class ClientsImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ClientsImportProcessor.name);

  constructor(
    @InjectRepository(ClientImportBatchEntity)
    private readonly batchRepository: Repository<ClientImportBatchEntity>,
    @InjectRepository(ClientImportRowErrorEntity)
    private readonly rowErrorRepository: Repository<ClientImportRowErrorEntity>,
    @InjectRepository(ClientEntity)
    private readonly clientRepository: Repository<ClientEntity>,
    @InjectRepository(AddressEntity)
    private readonly addressRepository: Repository<AddressEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(PlanEntity)
    private readonly planRepository: Repository<PlanEntity>,
    @InjectRepository(SectorEntity)
    private readonly sectorRepository: Repository<SectorEntity>,
    @InjectRepository(InvoiceEntity)
    private readonly invoiceRepository: Repository<InvoiceEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    private readonly minioStorage: MinioStorageService,
  ) {
    super();
  }

  async process(job: Job<{ batchId: string }>): Promise<void> {
    const batch = await this.batchRepository.findOneBy({ id: job.data.batchId });
    if (!batch) {
      this.logger.error(`Batch ${job.data.batchId} no encontrado; se descarta el job.`);
      return;
    }

    try {
      batch.status = 'PROCESSING';
      await this.batchRepository.save(batch);

      const buffer = await this.minioStorage.getObjectBuffer(batch.minioObjectKey);
      const { rows } = await parseLegacyClientFile(buffer, batch.originalFilename);

      const clientsByNormalizedDoc = await this.buildClientLookup();
      const planCache = new Map<string, PlanEntity>();
      const sectorCache = new Map<string, SectorEntity>();
      const credentialsCollected: ImportedClientCredentials[] = [];

      let processedRows = 0;
      let createdCount = 0;
      let updatedCount = 0;
      let errorCount = 0;

      for (const chunk of chunkArray(rows, CHUNK_SIZE)) {
        for (const row of chunk) {
          try {
            const outcome = await this.processRow(row, batch, clientsByNormalizedDoc, planCache, sectorCache, credentialsCollected);
            if (outcome === 'created') createdCount++;
            else updatedCount++;
          } catch (error: any) {
            errorCount++;
            await this.rowErrorRepository.save(
              this.rowErrorRepository.create({
                batchId: batch.id,
                rowNumber: row.rowNumber,
                rawData: row as any,
                errorMessage: error?.message || 'Error desconocido procesando la fila.',
              }),
            );
          }
          processedRows++;
        }

        batch.processedRows = processedRows;
        batch.createdCount = createdCount;
        batch.updatedCount = updatedCount;
        batch.errorCount = errorCount;
        await this.batchRepository.save(batch);
        await job.updateProgress(rows.length > 0 ? Math.round((processedRows / rows.length) * 100) : 100);
      }

      if (credentialsCollected.length > 0) {
        const reportBuffer = buildCredentialsReportCsv(credentialsCollected);
        batch.credentialsReportObjectKey = await this.minioStorage.uploadBuffer(
          reportBuffer,
          `credenciales_${batch.id}.csv`,
          'client-import-credentials',
          'text/csv',
        );
      }

      batch.status = 'DONE';
      batch.completedAt = new Date();
      await this.batchRepository.save(batch);
    } catch (error: any) {
      batch.status = 'FAILED';
      batch.failureReason = error?.message || 'Error desconocido procesando el batch.';
      batch.completedAt = new Date();
      await this.batchRepository.save(batch);
      throw error;
    }
  }

  private async buildClientLookup(): Promise<Map<string, ClientEntity>> {
    const clients = await this.clientRepository.find();
    const map = new Map<string, ClientEntity>();
    for (const client of clients) {
      map.set(normalizeDocNumber(client.docNumber), client);
    }
    return map;
  }

  private async processRow(
    row: LegacyClientRow,
    batch: ClientImportBatchEntity,
    clientsByNormalizedDoc: Map<string, ClientEntity>,
    planCache: Map<string, PlanEntity>,
    sectorCache: Map<string, SectorEntity>,
    credentialsCollected: ImportedClientCredentials[],
  ): Promise<RowOutcome> {
    if (!row.nombre.trim()) throw new Error('Falta el nombre del cliente.');
    if (!row.docNumber.trim()) throw new Error('Falta el número de documento.');

    const normalizedDoc = normalizeDocNumber(row.docNumber);
    const { docType } = inferDocType(row.docNumber);

    const locationKey = buildLocationKey(row.barrio, row.ciudadMunicipio);
    const sector = locationKey === '||' ? undefined : await this.resolveSector(locationKey, batch.locationMapping, sectorCache);

    let client = clientsByNormalizedDoc.get(normalizedDoc);
    const isNew = !client;

    if (!client) {
      client = this.clientRepository.create({
        clientType: 'FISICA',
        name: row.nombre.trim(),
        docType,
        docNumber: row.docNumber.trim(),
        email: '',
        phone: row.telefono.trim(),
        isActive: true,
      });
    } else {
      client.name = row.nombre.trim() || client.name;
      client.phone = row.telefono.trim() || client.phone;
    }
    client = await this.clientRepository.save(client);
    clientsByNormalizedDoc.set(normalizedDoc, client);

    // Todo cliente debe poder entrar al Portal de Autoservicio — incluye a
    // los ya existentes que se actualizan en este import, si por alguna
    // razón no tenían cuenta digital todavía. ensureDigitalAccount() es un
    // no-op (devuelve null) si client.userId ya está seteado. Las
    // credenciales nuevas se acumulan para el reporte descargable del batch
    // — no hay un admin imprimiendo el contrato de cada uno en el momento.
    const newCredentials = await this.ensureDigitalAccount(client);
    if (newCredentials) {
      credentialsCollected.push({
        name: client.name,
        docNumber: client.docNumber,
        username: newCredentials.username,
        password: newCredentials.password,
      });
    }

    let address = await this.addressRepository.findOne({ where: { clientId: client.id, isPrimary: true } });
    if (!address) {
      address = this.addressRepository.create({ clientId: client.id, isPrimary: true, street: '', sector: '', municipality: '', city: '' });
    }
    address.street = row.direccion.trim() || address.street;
    address.sector = row.barrio.trim() || address.sector;
    address.municipality = row.ciudadMunicipio.trim() || address.municipality;
    address.city = address.municipality;
    if (sector) {
      address.sectorId = sector.id;
      address.municipalityId = sector.municipalityId;
      address.provinceId = sector.municipality?.provinceId;
    }
    const gps = parseGpsCoordinates(row.coordenadas);
    if (gps) {
      address.gpsLatitude = gps.lat;
      address.gpsLongitude = gps.lng;
    }
    address = await this.addressRepository.save(address);

    const parsedPlan = parsePlanInternet(row.planInternet);
    if (parsedPlan) {
      const plan = await this.resolvePlan(parsedPlan, planCache);
      const { status } = mapEstadoToContractStatus(row.estado);
      const startDate = parseInstallDate(row.fechaInstalacion) || new Date().toISOString().slice(0, 10);

      let contract = await this.contractRepository.findOne({ where: { clientId: client.id }, order: { createdAt: 'DESC' } });
      if (!contract || contract.status === 'TERMINATED') {
        contract = this.contractRepository.create({
          contractNumber: `CTR-IMP-${batch.id.slice(0, 8)}-${row.rowNumber}`,
          clientId: client.id,
          planId: plan.id,
          addressId: address.id,
          startDate,
          billingDay: 15,
          status,
        });
      } else {
        contract.planId = plan.id;
        contract.addressId = address.id;
        contract.status = status;
      }
      await this.contractRepository.save(contract);

      const saldo = parseSaldo(row.saldo);
      if (saldo > 0) {
        const existingSaldoInvoice = await this.invoiceRepository.findOne({
          where: { clientId: client.id, concept: SALDO_INICIAL_CONCEPT, status: 'PENDING_PAYMENT' },
        });
        if (!existingSaldoInvoice) {
          await this.invoiceRepository.save(
            this.invoiceRepository.create({
              clientId: client.id,
              status: 'PENDING_PAYMENT',
              subtotal: saldo,
              itbisTotal: 0,
              cdtAmount: 0,
              grandTotal: saldo,
              concept: SALDO_INICIAL_CONCEPT,
            }),
          );
        }
      }
    }

    return isNew ? 'created' : 'updated';
  }

  /**
   * Crea la cuenta digital del Portal de Autoservicio (rol CLIENTE, username
   * = cédula normalizada, password aleatoria de 6 caracteres) — mismo
   * mecanismo que ClientsService.create() usa para el alta manual (RF-35).
   * No-op si el cliente ya tiene userId. Devuelve las credenciales SOLO
   * cuando de verdad se acaba de crear un UserEntity nuevo con esa
   * contraseña — si ya existía uno (username/email en colisión de un run
   * anterior), esa contraseña generada nunca se aplicó y reportarla sería
   * mentirle al admin sobre cuál es la contraseña real.
   */
  private async ensureDigitalAccount(client: ClientEntity): Promise<{ username: string; password: string } | null> {
    if (client.userId) return null;

    const initialPlainPassword = generateRandomPassword(6);
    const passwordHash = await bcrypt.hash(initialPlainPassword, 10);

    let clientRole = await this.roleRepository.findOneBy({ name: Role.CLIENTE });
    if (!clientRole) {
      clientRole = await this.roleRepository.save(
        this.roleRepository.create({
          name: Role.CLIENTE,
          description: 'Portal de Autoservicio y Autogestión del Cliente',
        }),
      );
    }

    const digitalUsername = normalizeDocNumber(client.docNumber).toLowerCase() || `usr_${Date.now()}`;
    const digitalEmail = client.email?.trim() ? client.email.toLowerCase() : `${digitalUsername}@${SYNTHETIC_EMAIL_DOMAIN}`;

    let digitalUser = await this.userRepository.findOne({
      where: [{ username: digitalUsername }, { email: digitalEmail }],
    });
    let createdNewUser = false;
    if (!digitalUser) {
      digitalUser = await this.userRepository.save(
        this.userRepository.create({
          username: digitalUsername,
          email: digitalEmail,
          passwordHash,
          isActive: true,
          roles: [clientRole],
        }),
      );
      createdNewUser = true;
    }

    client.userId = digitalUser.id;
    await this.clientRepository.save(client);

    return createdNewUser ? { username: digitalUsername, password: initialPlainPassword } : null;
  }

  private async resolveSector(
    locationKey: string,
    locationMapping: Record<string, LocationMappingTarget>,
    sectorCache: Map<string, SectorEntity>,
  ): Promise<SectorEntity> {
    const cached = sectorCache.get(locationKey);
    if (cached) return cached;

    const target = locationMapping[locationKey];
    if (!target) {
      throw new Error(`Ubicación "${locationKey}" no tiene mapeo resuelto.`);
    }

    let sector: SectorEntity | null;
    if (target.sectorId) {
      sector = await this.sectorRepository.findOne({ where: { id: target.sectorId }, relations: ['municipality'] });
      if (!sector) throw new Error(`Sector mapeado ${target.sectorId} ya no existe.`);
    } else if (target.createNew) {
      const existing = await this.sectorRepository.findOne({
        where: { name: target.createNew.name, municipalityId: target.createNew.municipalityId },
        relations: ['municipality'],
      });
      sector =
        existing ||
        (await this.sectorRepository.save(
          this.sectorRepository.create({
            name: target.createNew.name,
            municipalityId: target.createNew.municipalityId,
            isActive: true,
          }),
        ));
      if (!sector.municipality) {
        sector = await this.sectorRepository.findOne({ where: { id: sector.id }, relations: ['municipality'] });
      }
    } else {
      throw new Error(`Mapeo inválido para "${locationKey}".`);
    }

    if (!sector) throw new Error(`No se pudo resolver el sector para "${locationKey}".`);
    sectorCache.set(locationKey, sector);
    return sector;
  }

  private async resolvePlan(parsed: { speedMbps: number; monthlyPrice: number }, planCache: Map<string, PlanEntity>): Promise<PlanEntity> {
    const cacheKey = `${parsed.speedMbps}|${parsed.monthlyPrice}`;
    const cached = planCache.get(cacheKey);
    if (cached) return cached;

    let plan = await this.planRepository.findOne({
      where: { speedMbps: parsed.speedMbps, monthlyPrice: parsed.monthlyPrice as any },
    });
    if (!plan) {
      plan = await this.planRepository.save(
        this.planRepository.create({
          name: `Plan Importado ${parsed.speedMbps} Mbps`,
          serviceType: 'INTERNET',
          speedMbps: parsed.speedMbps,
          tvChannelsCount: 0,
          monthlyPrice: parsed.monthlyPrice,
          itbisRate: 0.18,
          cdtRate: 0.02,
          isFeatured: false,
          isActive: true,
        }),
      );
    }
    planCache.set(cacheKey, plan);
    return plan;
  }
}
