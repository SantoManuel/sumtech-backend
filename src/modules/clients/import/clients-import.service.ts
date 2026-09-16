import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { ClientImportBatchEntity, ClientImportFormat, LocationMappingTarget } from '../entities/client-import-batch.entity';
import { ClientImportRowErrorEntity } from '../entities/client-import-row-error.entity';
import { PlanEntity } from '../../plans/entities/plan.entity';
import { SectorEntity } from '../../geography/entities/sector.entity';
import { MunicipalityEntity } from '../../geography/entities/municipality.entity';
import { MinioStorageService } from '../../storage/minio-storage.service';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { SubmitLocationMappingDto } from '../dto/submit-location-mapping.dto';
import { parseLegacyClientFile } from './legacy-client-parser';
import { buildLocationKey, parsePlanInternet } from './legacy-field-mappers';
import { LegacyClientRow } from './legacy-client-row.types';
import { ClientImportAnalysisResult, DistinctLocationSummary, DistinctPlanSummary } from './client-import-analysis.types';

export const CLIENTS_IMPORT_QUEUE = 'clients-import';

@Injectable()
export class ClientsImportService {
  constructor(
    @InjectRepository(ClientImportBatchEntity)
    private readonly batchRepository: Repository<ClientImportBatchEntity>,
    @InjectRepository(ClientImportRowErrorEntity)
    private readonly rowErrorRepository: Repository<ClientImportRowErrorEntity>,
    @InjectRepository(PlanEntity)
    private readonly planRepository: Repository<PlanEntity>,
    @InjectRepository(SectorEntity)
    private readonly sectorRepository: Repository<SectorEntity>,
    @InjectRepository(MunicipalityEntity)
    private readonly municipalityRepository: Repository<MunicipalityEntity>,
    private readonly minioStorage: MinioStorageService,
    @InjectQueue(CLIENTS_IMPORT_QUEUE)
    private readonly importQueue: Queue,
  ) {}

  async analyze(file: Express.Multer.File | undefined, uploadedByUserId: string): Promise<ClientImportAnalysisResult> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Debe adjuntar un archivo (.csv o .xlsx).');
    }

    const format = this.detectFormat(file.originalname);
    const { rows, recognizedColumns } = await parseLegacyClientFile(file.buffer, file.originalname);
    if (rows.length === 0) {
      throw new BadRequestException('El archivo no tiene filas de datos.');
    }

    const objectKey = await this.minioStorage.uploadBuffer(file.buffer, file.originalname, 'client-imports', file.mimetype);

    const distinctLocations = this.summarizeLocations(rows, {});
    const distinctPlans = await this.summarizePlans(rows);
    const rowsMissingRequiredFields = rows.filter((row) => !row.nombre.trim() || !row.docNumber.trim()).length;

    const batch = await this.batchRepository.save(
      this.batchRepository.create({
        status: distinctLocations.length === 0 ? 'MAPPED' : 'ANALYZED',
        format,
        originalFilename: file.originalname,
        minioObjectKey: objectKey,
        totalRows: rows.length,
        uploadedBy: uploadedByUserId,
        locationMapping: {},
      }),
    );

    return {
      batchId: batch.id,
      format,
      totalRows: rows.length,
      recognizedColumns,
      distinctLocations,
      distinctPlans,
      rowsMissingRequiredFields,
    };
  }

  async submitLocationMapping(
    batchId: string,
    dto: SubmitLocationMappingDto,
  ): Promise<{ resolved: boolean; missingKeys: string[] }> {
    const batch = await this.getBatchOrFail(batchId);
    if (batch.status !== 'ANALYZED' && batch.status !== 'MAPPED') {
      throw new BadRequestException(
        `No se puede editar el mapeo de ubicación de un batch en estado ${batch.status}.`,
      );
    }

    const updatedMapping: Record<string, LocationMappingTarget> = { ...batch.locationMapping };

    for (const entry of dto.mappings) {
      if (!entry.sectorId && !entry.createNew) {
        throw new BadRequestException(`La ubicación "${entry.legacyLocationKey}" debe indicar sectorId o createNew.`);
      }
      if (entry.sectorId) {
        const sector = await this.sectorRepository.findOneBy({ id: entry.sectorId });
        if (!sector) {
          throw new BadRequestException(`Sector ${entry.sectorId} no encontrado.`);
        }
        updatedMapping[entry.legacyLocationKey] = { sectorId: entry.sectorId };
      } else if (entry.createNew) {
        const municipality = await this.municipalityRepository.findOneBy({ id: entry.createNew.municipalityId });
        if (!municipality) {
          throw new BadRequestException(`Municipio ${entry.createNew.municipalityId} no encontrado.`);
        }
        updatedMapping[entry.legacyLocationKey] = {
          createNew: { name: entry.createNew.name, municipalityId: entry.createNew.municipalityId },
        };
      }
    }

    const { rows } = await this.reparseStoredFile(batch);
    const distinctKeys = new Set(
      rows.map((row) => buildLocationKey(row.barrio, row.ciudadMunicipio)).filter((key) => key !== '||'),
    );
    const missingKeys = [...distinctKeys].filter((key) => !updatedMapping[key]);

    batch.locationMapping = updatedMapping;
    batch.status = missingKeys.length === 0 ? 'MAPPED' : 'ANALYZED';
    await this.batchRepository.save(batch);

    return { resolved: missingKeys.length === 0, missingKeys };
  }

  async confirm(batchId: string): Promise<void> {
    const batch = await this.getBatchOrFail(batchId);
    if (batch.status !== 'MAPPED') {
      throw new BadRequestException(
        `El batch debe estar en estado MAPPED antes de confirmar (estado actual: ${batch.status}). ` +
          'Resuelva primero el mapeo de ubicación.',
      );
    }

    batch.status = 'QUEUED';
    await this.batchRepository.save(batch);
    await this.importQueue.add('process-batch', { batchId: batch.id }, { removeOnComplete: true, removeOnFail: false });
  }

  async getStatus(batchId: string): Promise<ClientImportBatchEntity> {
    return this.getBatchOrFail(batchId);
  }

  async getErrors(batchId: string, pagination: PaginationDto) {
    await this.getBatchOrFail(batchId);
    const page = pagination.page || 1;
    const limit = pagination.limit || 50;

    const [data, total] = await this.rowErrorRepository.findAndCount({
      where: { batchId },
      order: { rowNumber: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Reporte de usuario/contraseña de los clientes creados en el batch — solo
   * existe si el batch terminó DONE con al menos un cliente nuevo (ver
   * ClientsImportProcessor). Se descarga como archivo adjunto, mismo patrón
   * que ClientsExportService.
   */
  async getCredentialsReport(batchId: string): Promise<{ buffer: Buffer; filename: string }> {
    const batch = await this.getBatchOrFail(batchId);
    if (!batch.credentialsReportObjectKey) {
      throw new NotFoundException(
        'Este batch no tiene un reporte de credenciales (todavía no terminó, o no creó clientes nuevos).',
      );
    }
    const buffer = await this.minioStorage.getObjectBuffer(batch.credentialsReportObjectKey);
    return { buffer, filename: `credenciales_${batch.id}.csv` };
  }

  async listBatches(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 15;

    const [data, total] = await this.batchRepository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  private async getBatchOrFail(batchId: string): Promise<ClientImportBatchEntity> {
    const batch = await this.batchRepository.findOneBy({ id: batchId });
    if (!batch) {
      throw new NotFoundException(`Batch de importación ${batchId} no encontrado.`);
    }
    return batch;
  }

  private async reparseStoredFile(batch: ClientImportBatchEntity) {
    const buffer = await this.minioStorage.getObjectBuffer(batch.minioObjectKey);
    return parseLegacyClientFile(buffer, batch.originalFilename);
  }

  private detectFormat(filename: string): ClientImportFormat {
    const extension = filename.toLowerCase().split('.').pop();
    if (extension === 'xlsx' || extension === 'xls') return 'excel';
    return 'csv';
  }

  private summarizeLocations(
    rows: LegacyClientRow[],
    existingMapping: Record<string, LocationMappingTarget>,
  ): DistinctLocationSummary[] {
    const byKey = new Map<string, { barrio: string; ciudadMunicipio: string; occurrences: number }>();

    for (const row of rows) {
      const key = buildLocationKey(row.barrio, row.ciudadMunicipio);
      if (key === '||') continue;
      const existing = byKey.get(key);
      if (existing) {
        existing.occurrences += 1;
      } else {
        byKey.set(key, { barrio: row.barrio.trim(), ciudadMunicipio: row.ciudadMunicipio.trim(), occurrences: 1 });
      }
    }

    return [...byKey.entries()]
      .map(([legacyLocationKey, value]) => ({
        legacyLocationKey,
        barrio: value.barrio,
        ciudadMunicipio: value.ciudadMunicipio,
        occurrences: value.occurrences,
        resolved: Boolean(existingMapping[legacyLocationKey]),
      }))
      .sort((a, b) => b.occurrences - a.occurrences);
  }

  private async summarizePlans(rows: LegacyClientRow[]): Promise<DistinctPlanSummary[]> {
    const byRaw = new Map<string, number>();
    for (const row of rows) {
      const raw = row.planInternet.trim();
      if (!raw) continue;
      byRaw.set(raw, (byRaw.get(raw) || 0) + 1);
    }

    const results: DistinctPlanSummary[] = [];
    for (const [raw, occurrences] of byRaw.entries()) {
      const parsed = parsePlanInternet(raw);
      let matchesExistingPlan = false;
      if (parsed) {
        const existing = await this.planRepository.findOne({
          where: { speedMbps: parsed.speedMbps, monthlyPrice: parsed.monthlyPrice as any },
        });
        matchesExistingPlan = Boolean(existing);
      }
      results.push({
        raw,
        speedMbps: parsed?.speedMbps ?? null,
        monthlyPrice: parsed?.monthlyPrice ?? null,
        parseable: Boolean(parsed),
        occurrences,
        matchesExistingPlan,
      });
    }

    return results.sort((a, b) => b.occurrences - a.occurrences);
  }
}
