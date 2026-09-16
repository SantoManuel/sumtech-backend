import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientEntity } from '../entities/client.entity';
import { ContractEntity } from '../entities/contract.entity';
import { AuditLogEntity } from '../../users/entities/audit-log.entity';
import { PlanEntity } from '../../plans/entities/plan.entity';
import { SectorEntity } from '../../geography/entities/sector.entity';
import { MunicipalityEntity } from '../../geography/entities/municipality.entity';
import { ProvinceEntity } from '../../geography/entities/province.entity';
import { PdfGeneratorService } from '../../printing/pdf-generator.service';
import { DgiiClientService } from '../../invoicing/dgii/dgii-client.service';
import { CompanyService } from '../../company/company.service';
import { ExportClientsDto } from '../dto/export-clients.dto';
import { buildClientsCsv } from './csv-builder';
import { buildClientsExcel } from './excel-builder';
import { ClientExportRow, ClientsExportResult } from './clients-export.types';
import { CompanyPdfInfo, ClientsListPdfRow } from '../../printing/pdf-generator.types';

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  PENDING_INSTALL: 'Pendiente de Instalación',
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  TERMINATED: 'Terminado',
};

/**
 * Máximo de filas para PDF — un listado paginado de decenas de miles de
 * registros es impráctico para imprimir/revisar; Excel y CSV sí toleran el
 * tope general de EXPORT_MAX_ROWS (ver export-clients.dto.ts).
 */
const PDF_EXPORT_MAX_ROWS = 2000;

function formatDateEs(value: Date | string | undefined | null): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

@Injectable()
export class ClientsExportService {
  constructor(
    @InjectRepository(ClientEntity)
    private readonly clientRepository: Repository<ClientEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
    @InjectRepository(PlanEntity)
    private readonly planRepository: Repository<PlanEntity>,
    @InjectRepository(SectorEntity)
    private readonly sectorRepository: Repository<SectorEntity>,
    @InjectRepository(MunicipalityEntity)
    private readonly municipalityRepository: Repository<MunicipalityEntity>,
    @InjectRepository(ProvinceEntity)
    private readonly provinceRepository: Repository<ProvinceEntity>,
    private readonly pdfGenerator: PdfGeneratorService,
    private readonly dgiiClient: DgiiClientService,
    @Optional() private readonly companyService?: CompanyService,
  ) {}

  async export(
    dto: ExportClientsDto,
    requestedByUserId: string,
    requestedByUsername: string,
    ipAddress?: string,
  ): Promise<ClientsExportResult> {
    if (dto.format === 'pdf' && dto.limit > PDF_EXPORT_MAX_ROWS) {
      throw new BadRequestException(
        `El formato PDF admite un máximo de ${PDF_EXPORT_MAX_ROWS} clientes por exportación. Para cantidades mayores, use Excel o CSV.`,
      );
    }

    const clients = await this.fetchClients(dto);
    const rows = clients.map((client) => this.mapClientToRow(client, dto.planId));

    let buffer: Buffer;
    let contentType: string;
    let extension: string;

    if (dto.format === 'csv') {
      buffer = buildClientsCsv(rows);
      contentType = 'text/csv; charset=utf-8';
      extension = 'csv';
    } else if (dto.format === 'excel') {
      buffer = await buildClientsExcel(rows);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      extension = 'xlsx';
    } else {
      const company = await this.resolveCompanyInfo();
      const filtersSummary = await this.buildFiltersSummary(dto);
      buffer = await this.pdfGenerator.generateClientsListPdf({
        company,
        rows: rows.map((row) => this.toPdfRow(row)),
        totalExportado: rows.length,
        generatedByUsername: requestedByUsername,
        generatedAt: new Date(),
        filtersSummary,
      });
      contentType = 'application/pdf';
      extension = 'pdf';
    }

    const filename = `clientes_${this.timestampForFilename()}.${extension}`;

    await this.auditLogRepository.save(
      this.auditLogRepository.create({
        userId: requestedByUserId,
        action: 'CLIENTS_EXPORT',
        entity: 'client',
        ipAddress,
        payloadDiff: {
          format: dto.format,
          limitSolicitado: dto.limit,
          totalExportado: rows.length,
          filtros: {
            search: dto.search || undefined,
            isActive: dto.isActive,
            planId: dto.planId,
            provinceId: dto.provinceId,
            municipalityId: dto.municipalityId,
            sectorId: dto.sectorId,
          },
        },
      }),
    );

    return { buffer, filename, contentType, totalExportado: rows.length };
  }

  private async fetchClients(dto: ExportClientsDto): Promise<ClientEntity[]> {
    const query = this.clientRepository
      .createQueryBuilder('client')
      .leftJoinAndSelect('client.addresses', 'address', 'address.isPrimary = :isPrimary', { isPrimary: true })
      .leftJoinAndSelect('client.contracts', 'contract')
      .leftJoinAndSelect('contract.plan', 'plan')
      .orderBy('client.name', 'ASC')
      .take(dto.limit);

    if (dto.search) {
      query.andWhere(
        '(client.name ILIKE :search OR client.docNumber ILIKE :search OR client.email ILIKE :search OR client.phone ILIKE :search)',
        { search: `%${dto.search}%` },
      );
    }

    if (dto.isActive !== undefined) {
      query.andWhere('client.isActive = :isActive', { isActive: dto.isActive });
    }

    if (dto.planId) {
      query.andWhere(
        `EXISTS (SELECT 1 FROM com.contracts export_pc WHERE export_pc.client_id = client.id AND export_pc.plan_id = :planId AND export_pc.status = 'ACTIVE')`,
        { planId: dto.planId },
      );
    }

    // Ubicación en cascada: se aplica el filtro más específico presente.
    if (dto.sectorId) {
      query.andWhere('address.sectorId = :sectorId', { sectorId: dto.sectorId });
    } else if (dto.municipalityId) {
      query.andWhere('address.municipalityId = :municipalityId', { municipalityId: dto.municipalityId });
    } else if (dto.provinceId) {
      query.andWhere('address.provinceId = :provinceId', { provinceId: dto.provinceId });
    }

    return query.getMany();
  }

  /**
   * Arma la fila plana de un cliente. Si `preferredPlanId` viene informado
   * (filtro "Plan Activo" aplicado), prioriza mostrar ese contrato ACTIVE en
   * particular sobre cualquier otro — evita mostrar un plan distinto al que
   * el admin filtró, en el caso (raro) de que un cliente tenga más de un
   * contrato ACTIVE simultáneo.
   */
  private mapClientToRow(client: ClientEntity, preferredPlanId?: string): ClientExportRow {
    const address = client.addresses?.[0];
    const contracts = client.contracts || [];
    const contract =
      (preferredPlanId && contracts.find((c) => c.status === 'ACTIVE' && c.planId === preferredPlanId)) ||
      contracts.find((c) => c.status === 'ACTIVE') ||
      [...contracts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    const gps =
      address?.gpsLatitude !== undefined && address?.gpsLatitude !== null && address?.gpsLongitude !== undefined && address?.gpsLongitude !== null
        ? `${address.gpsLatitude}, ${address.gpsLongitude}`
        : '';

    return {
      nombre: client.name,
      tipoCliente: client.clientType === 'JURIDICA' ? 'Jurídica' : 'Física',
      tipoDocumento: client.docType,
      numeroDocumento: client.docNumber,
      telefono: client.phone || '',
      telefonoAlterno: client.altPhone || '',
      email: client.email || '',
      direccion: [address?.street, address?.buildingNumber].filter(Boolean).join(' '),
      sectorBarrio: address?.sector || '',
      municipio: address?.municipality || '',
      provinciaCiudad: address?.city || '',
      coordenadasGps: gps,
      planActivo: contract?.plan?.name || 'Sin Contrato',
      numeroContrato: contract?.contractNumber || '',
      fechaInicioContrato: formatDateEs(contract?.startDate),
      estadoContrato: contract ? CONTRACT_STATUS_LABELS[contract.status] || contract.status : '',
      estadoCliente: client.isActive ? 'Activo' : 'Inactivo',
      fechaAlta: formatDateEs(client.createdAt),
      clienteId: client.id,
    };
  }

  private toPdfRow(row: ClientExportRow): ClientsListPdfRow {
    return {
      nombre: row.nombre,
      tipoCliente: row.tipoCliente,
      documento: `${row.tipoDocumento}: ${row.numeroDocumento}`,
      telefono: row.telefono,
      ubicacion: [row.sectorBarrio, row.municipio].filter(Boolean).join(', '),
      planActivo: row.planActivo,
      estadoContrato: row.estadoContrato,
      estadoCliente: row.estadoCliente,
      fechaAlta: row.fechaAlta,
    };
  }

  private async resolveCompanyInfo(): Promise<CompanyPdfInfo> {
    if (this.companyService) {
      const fiscal = await this.companyService.getCompanyFiscalInfo();
      return {
        rnc: fiscal.rnc,
        razonSocial: fiscal.razonSocial,
        nombreComercial: fiscal.nombreComercial,
        direccion: fiscal.direccion,
        telefono: fiscal.telefono,
        correo: fiscal.correo,
      };
    }
    const config = this.dgiiClient.getConfig();
    return {
      rnc: config.rncEmisor,
      razonSocial: config.razonSocialEmisor,
      nombreComercial: config.nombreComercial,
      direccion: config.direccionEmisor,
      telefono: config.telefonoEmisor,
      correo: config.correoEmisor,
    };
  }

  private async buildFiltersSummary(dto: ExportClientsDto): Promise<string> {
    const parts: string[] = [];

    if (dto.search) parts.push(`Búsqueda: "${dto.search}"`);
    if (dto.isActive !== undefined) parts.push(`Estado: ${dto.isActive ? 'Activo' : 'Inactivo'}`);

    if (dto.planId) {
      const plan = await this.planRepository.findOneBy({ id: dto.planId });
      parts.push(`Plan: ${plan?.name || dto.planId}`);
    }

    if (dto.sectorId) {
      const sector = await this.sectorRepository.findOne({
        where: { id: dto.sectorId },
        relations: ['municipality', 'municipality.province'],
      });
      if (sector) {
        parts.push(`Ubicación: ${[sector.name, sector.municipality?.name, sector.municipality?.province?.name].filter(Boolean).join(', ')}`);
      } else {
        parts.push(`Sector: ${dto.sectorId}`);
      }
    } else if (dto.municipalityId) {
      const municipality = await this.municipalityRepository.findOne({
        where: { id: dto.municipalityId },
        relations: ['province'],
      });
      if (municipality) {
        parts.push(`Ubicación: ${[municipality.name, municipality.province?.name].filter(Boolean).join(', ')}`);
      } else {
        parts.push(`Municipio: ${dto.municipalityId}`);
      }
    } else if (dto.provinceId) {
      const province = await this.provinceRepository.findOneBy({ id: dto.provinceId });
      parts.push(`Ubicación: ${province?.name || dto.provinceId}`);
    }

    return parts.length > 0 ? parts.join(' · ') : 'Ninguno';
  }

  private timestampForFilename(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  }
}
