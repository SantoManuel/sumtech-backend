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
import { buildLocationKey, matchPlanByName, normalizeGeoName, parsePlanInternet } from './legacy-field-mappers';
import { LegacyClientRow } from './legacy-client-row.types';
import { ClientImportAnalysisResult, DistinctLocationSummary, DistinctPlanSummary } from './client-import-analysis.types';

export const CLIENTS_IMPORT_QUEUE = 'clients-import';

interface AutoResolvedLocation {
  target: LocationMappingTarget;
  provinceName: string;
  municipalityName: string;
  sectorName: string;
  sectorIsNew: boolean;
}

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

    const autoResolved = await this.autoResolveLocations(rows);
    const distinctLocations = this.summarizeLocations(rows, autoResolved);
    const distinctPlans = await this.summarizePlans(rows);
    const rowsMissingRequiredFields = rows.filter((row) => !row.nombre.trim() || !row.docNumber.trim()).length;

    const locationMapping: Record<string, LocationMappingTarget> = {};
    for (const [key, value] of autoResolved) {
      locationMapping[key] = value.target;
    }
    const unresolvedCount = distinctLocations.filter((loc) => !loc.resolved).length;

    const batch = await this.batchRepository.save(
      this.batchRepository.create({
        status: unresolvedCount === 0 ? 'MAPPED' : 'ANALYZED',
        format,
        originalFilename: file.originalname,
        minioObjectKey: objectKey,
        totalRows: rows.length,
        uploadedBy: uploadedByUserId,
        locationMapping,
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
    autoResolved: Map<string, AutoResolvedLocation>,
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
      .map(([legacyLocationKey, value]) => {
        const auto = autoResolved.get(legacyLocationKey);
        return {
          legacyLocationKey,
          barrio: value.barrio,
          ciudadMunicipio: value.ciudadMunicipio,
          occurrences: value.occurrences,
          resolved: Boolean(auto),
          autoMatch: auto
            ? {
                provinceName: auto.provinceName,
                municipalityName: auto.municipalityName,
                sectorName: auto.sectorName,
                sectorIsNew: auto.sectorIsNew,
              }
            : undefined,
        };
      })
      .sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Intenta resolver cada ubicación distinta (Barrio + Ciudad/Municipio) del
   * archivo contra el catálogo geográfico ya existente, sin intervención del
   * admin:
   * - Ciudad/Municipio se compara (sin tildes/mayúsculas) contra
   *   MunicipalityEntity.name. Si hay exactamente un match, se usa esa
   *   provincia/municipio (nunca se inventa una provincia: el archivo legado
   *   no trae esa columna, así que un municipio sin match ambiguo o
   *   inexistente queda para resolución manual — más seguro que adivinar).
   * - Barrio/Localidad se compara contra SectorEntity.name dentro de ese
   *   municipio. Si existe, se reutiliza; si no, se marca createNew (el
   *   sector se crea recién al confirmar — ver ClientsImportProcessor -
   *   resolveSector()), así una importación cancelada no deja sectores
   *   huérfanos en el catálogo.
   */
  private async autoResolveLocations(rows: LegacyClientRow[]): Promise<Map<string, AutoResolvedLocation>> {
    const distinctByKey = new Map<string, { barrio: string; ciudadMunicipio: string }>();
    for (const row of rows) {
      const key = buildLocationKey(row.barrio, row.ciudadMunicipio);
      if (key === '||' || distinctByKey.has(key)) continue;
      distinctByKey.set(key, { barrio: row.barrio.trim(), ciudadMunicipio: row.ciudadMunicipio.trim() });
    }

    const result = new Map<string, AutoResolvedLocation>();
    if (distinctByKey.size === 0) return result;

    const municipalities = await this.municipalityRepository.find({
      where: { isActive: true },
      relations: ['province'],
    });
    const municipalitiesByName = new Map<string, MunicipalityEntity[]>();
    for (const municipality of municipalities) {
      const key = normalizeGeoName(municipality.name);
      const bucket = municipalitiesByName.get(key) || [];
      bucket.push(municipality);
      municipalitiesByName.set(key, bucket);
    }

    const sectorsByMunicipality = new Map<string, SectorEntity[]>();

    for (const [key, { barrio, ciudadMunicipio }] of distinctByKey) {
      if (!barrio || !ciudadMunicipio) continue;

      const municipality = this.findMunicipalityMatch(ciudadMunicipio, municipalitiesByName, municipalities);
      if (!municipality) continue;

      let sectors = sectorsByMunicipality.get(municipality.id);
      if (!sectors) {
        sectors = await this.sectorRepository.find({ where: { municipalityId: municipality.id, isActive: true } });
        sectorsByMunicipality.set(municipality.id, sectors);
      }
      const normalizedBarrio = normalizeGeoName(barrio);
      const existingSector = sectors.find((s) => normalizeGeoName(s.name) === normalizedBarrio);

      result.set(key, {
        target: existingSector ? { sectorId: existingSector.id } : { createNew: { name: barrio, municipalityId: municipality.id } },
        provinceName: municipality.province?.name || '',
        municipalityName: municipality.name,
        sectorName: existingSector ? existingSector.name : barrio,
        sectorIsNew: !existingSector,
      });
    }

    return result;
  }

  /**
   * Resuelve el municipio de una fila legada contra el catálogo, tolerando el
   * caso frecuente en RD de que el export legado use el nombre corto/coloquial
   * ("Azua") mientras el catálogo oficial usa el nombre largo ("Azua de
   * Compostela", "San Juan de la Maguana", etc.):
   * 1. Match exacto (normalizado) primero — es el caso más común y el más barato.
   * 2. Si no hay exacto, empareja por prefijo con borde de palabra en ambas
   *    direcciones ("azua" vs "azua de compostela"). Nunca por substring
   *    libre — evitaría falsos positivos tipo "San Juan" vs "San Juan Bautista".
   * Si el resultado es ambiguo (más de un municipio candidato) o no hay
   * ninguno, devuelve null y esa ubicación queda para resolución manual.
   */
  private findMunicipalityMatch(
    ciudadMunicipio: string,
    municipalitiesByName: Map<string, MunicipalityEntity[]>,
    allMunicipalities: MunicipalityEntity[],
  ): MunicipalityEntity | null {
    const normalizedCiudad = normalizeGeoName(ciudadMunicipio);

    const exactMatches = municipalitiesByName.get(normalizedCiudad) || [];
    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1) return null;

    const prefixMatches = allMunicipalities.filter((m) => {
      const normalizedName = normalizeGeoName(m.name);
      return normalizedName.startsWith(`${normalizedCiudad} `) || normalizedCiudad.startsWith(`${normalizedName} `);
    });
    return prefixMatches.length === 1 ? prefixMatches[0] : null;
  }

  private async summarizePlans(rows: LegacyClientRow[]): Promise<DistinctPlanSummary[]> {
    const byRaw = new Map<string, number>();
    for (const row of rows) {
      const raw = row.planInternet.trim();
      if (!raw) continue;
      byRaw.set(raw, (byRaw.get(raw) || 0) + 1);
    }

    // Solo se pide el catálogo completo si hace falta (hay algún texto que
    // parsePlanInternet no supo interpretar) — evita la query cuando el
    // archivo trae únicamente el formato "<velocidad> Mbps <precio>".
    const needsNameMatch = [...byRaw.keys()].some((raw) => !parsePlanInternet(raw));
    const existingPlans = needsNameMatch ? await this.planRepository.find({ where: { isActive: true } }) : [];

    const results: DistinctPlanSummary[] = [];
    for (const [raw, occurrences] of byRaw.entries()) {
      let parsed = parsePlanInternet(raw);
      let matchesExistingPlan = false;

      if (parsed) {
        const existing = await this.planRepository.findOne({
          where: { speedMbps: parsed.speedMbps, monthlyPrice: parsed.monthlyPrice as any },
        });
        matchesExistingPlan = Boolean(existing);
      } else {
        // Formato "<nombre comercial> <precio>" sin velocidad explícita (ej.
        // "PYME Basico 2800.00") — se busca por nombre+precio exactos contra
        // el catálogo en vez de dejarlo sin contrato (ver matchPlanByName()).
        const namedMatch = matchPlanByName(raw, existingPlans);
        if (namedMatch) {
          parsed = { speedMbps: namedMatch.speedMbps, monthlyPrice: Number(namedMatch.monthlyPrice) };
          matchesExistingPlan = true;
        }
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
