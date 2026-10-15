import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SerialNumberEntity } from '../entities/serial-number.entity';
import { WarehouseEntity } from '../entities/warehouse.entity';
import { CategoryEntity } from '../entities/category.entity';
import { SupplierEntity } from '../entities/supplier.entity';
import { EquipmentMovementService } from './equipment-movement.service';
import { PdfGeneratorService } from '../../printing/pdf-generator.service';
import { CompanyService } from '../../company/company.service';
import { CompanyPdfInfo, EquipmentListPdfRow } from '../../printing/pdf-generator.types';
import { ExportEquipmentDto } from '../dto/export-equipment.dto';
import { buildCsvBuffer, CsvColumn } from '../../../common/utils/csv-builder.util';
import { EquipmentLocationType } from '../enums/equipment.enums';

/**
 * Un PDF paginado con decenas de miles de filas es impráctico para imprimir;
 * CSV sí tolera el tope general de ExportEquipmentDto (EQUIPMENT_EXPORT_MAX_ROWS).
 */
const PDF_EXPORT_MAX_ROWS = 2000;

const LOCATION_LABELS: Record<EquipmentLocationType, string> = {
  [EquipmentLocationType.WAREHOUSE]: 'En almacén',
  [EquipmentLocationType.TECHNICIAN]: 'Con técnico',
  [EquipmentLocationType.CLIENT]: 'Instalado en cliente',
  [EquipmentLocationType.REPAIR_VENDOR]: 'En reparación',
  [EquipmentLocationType.RETIRED]: 'Dado de baja',
  [EquipmentLocationType.LOST]: 'Extraviado',
};

interface EquipmentExportRow {
  serial: string;
  mac: string;
  producto: string;
  sku: string;
  marca: string;
  modelo: string;
  categoria: string;
  proveedor: string;
  ubicacion: string;
  custodia: string;
  condicion: string;
  fechaAsignacion: string;
}

const CSV_COLUMNS: CsvColumn<EquipmentExportRow>[] = [
  { key: 'serial', header: 'Serial' },
  { key: 'mac', header: 'MAC' },
  { key: 'producto', header: 'Producto' },
  { key: 'sku', header: 'SKU' },
  { key: 'marca', header: 'Marca' },
  { key: 'modelo', header: 'Modelo' },
  { key: 'categoria', header: 'Categoría' },
  { key: 'proveedor', header: 'Proveedor' },
  { key: 'ubicacion', header: 'Ubicación' },
  { key: 'custodia', header: 'Custodia' },
  { key: 'condicion', header: 'Condición' },
  { key: 'fechaAsignacion', header: 'Fecha de Asignación' },
];

function formatDateEs(value: Date | string | undefined | null): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Misma lógica que `describeCustody()` del frontend (lib/inventory-labels.ts), replicada en servidor para el export. */
function describeCustody(item: SerialNumberEntity): string {
  switch (item.locationType) {
    case EquipmentLocationType.WAREHOUSE:
      return item.currentWarehouse?.name || 'Almacén Central';
    case EquipmentLocationType.TECHNICIAN:
      return item.currentEmployee?.user?.username || item.currentEmployee?.jobTitle || 'Técnico';
    case EquipmentLocationType.CLIENT:
      return item.client?.name || 'Cliente';
    case EquipmentLocationType.REPAIR_VENDOR:
      return 'Proveedor de reparación';
    case EquipmentLocationType.RETIRED:
      return 'Dado de baja';
    case EquipmentLocationType.LOST:
      return 'Extraviado';
    default:
      return '—';
  }
}

export interface InventoryExportResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
  totalExportado: number;
}

@Injectable()
export class InventoryExportService {
  constructor(
    @InjectRepository(SerialNumberEntity)
    private readonly serialRepository: Repository<SerialNumberEntity>,
    @InjectRepository(WarehouseEntity)
    private readonly warehouseRepository: Repository<WarehouseEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
    @InjectRepository(SupplierEntity)
    private readonly supplierRepository: Repository<SupplierEntity>,
    private readonly equipmentMovementService: EquipmentMovementService,
    private readonly pdfGenerator: PdfGeneratorService,
    @Optional() private readonly companyService?: CompanyService,
  ) {}

  async export(dto: ExportEquipmentDto, requestedByUsername: string): Promise<InventoryExportResult> {
    if (dto.format === 'pdf' && dto.limit > PDF_EXPORT_MAX_ROWS) {
      throw new BadRequestException(
        `El formato PDF admite un máximo de ${PDF_EXPORT_MAX_ROWS} equipos por exportación. Para cantidades mayores, use CSV.`,
      );
    }

    const equipment = await this.equipmentMovementService.exportEquipment(dto);
    const limited = equipment.slice(0, dto.limit);
    const rows = limited.map((item) => this.mapEquipmentToRow(item));

    let buffer: Buffer;
    let contentType: string;
    let extension: string;

    if (dto.format === 'csv') {
      buffer = buildCsvBuffer(rows, CSV_COLUMNS);
      contentType = 'text/csv; charset=utf-8';
      extension = 'csv';
    } else {
      const company = await this.resolveCompanyInfo();
      const filtersSummary = await this.buildFiltersSummary(dto);
      buffer = await this.pdfGenerator.generateEquipmentListPdf({
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

    const filename = `equipos_${this.timestampForFilename()}.${extension}`;
    return { buffer, filename, contentType, totalExportado: rows.length };
  }

  private mapEquipmentToRow(item: SerialNumberEntity): EquipmentExportRow {
    return {
      serial: item.serialNumber,
      mac: item.macAddress || '',
      producto: item.product?.name || '',
      sku: item.product?.sku || '',
      marca: item.product?.brand || '',
      modelo: item.product?.model || '',
      categoria: item.product?.category?.name || '',
      proveedor: item.product?.supplier?.businessName || item.product?.supplier?.tradeName || '',
      ubicacion: LOCATION_LABELS[item.locationType] || item.locationType,
      custodia: describeCustody(item),
      condicion: item.condition,
      fechaAsignacion: formatDateEs(item.assignedAt),
    };
  }

  private toPdfRow(row: EquipmentExportRow): EquipmentListPdfRow {
    return {
      serial: row.serial,
      mac: row.mac,
      producto: row.producto,
      sku: row.sku,
      categoria: row.categoria,
      proveedor: row.proveedor,
      ubicacion: [row.ubicacion, row.custodia].filter(Boolean).join(' — '),
      condicion: row.condicion,
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
    return { rnc: '', razonSocial: 'Sumtech' };
  }

  private async buildFiltersSummary(dto: ExportEquipmentDto): Promise<string> {
    const parts: string[] = [];

    if (dto.search) parts.push(`Búsqueda: "${dto.search}"`);
    if (dto.productId) parts.push(`Producto: ${dto.productId}`);
    if (dto.locationType) parts.push(`Ubicación: ${LOCATION_LABELS[dto.locationType] || dto.locationType}`);
    if (dto.condition) parts.push(`Condición: ${dto.condition}`);
    if (dto.articleType) parts.push(`Tipo de artículo: ${dto.articleType}`);

    if (dto.warehouseId) {
      const warehouse = await this.warehouseRepository.findOneBy({ id: dto.warehouseId });
      parts.push(`Almacén: ${warehouse?.name || dto.warehouseId}`);
    }
    if (dto.categoryId) {
      const category = await this.categoryRepository.findOneBy({ id: dto.categoryId });
      parts.push(`Categoría: ${category?.name || dto.categoryId}`);
    }
    if (dto.supplierId) {
      const supplier = await this.supplierRepository.findOneBy({ id: dto.supplierId });
      parts.push(`Proveedor: ${supplier?.businessName || supplier?.tradeName || dto.supplierId}`);
    }
    if (dto.sku) parts.push(`SKU: ${dto.sku}`);

    return parts.length > 0 ? parts.join(' · ') : 'Ninguno';
  }

  private timestampForFilename(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  }
}
