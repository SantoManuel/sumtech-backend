import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProductEntity } from '../entities/product.entity';
import { WarehouseEntity } from '../entities/warehouse.entity';
import { SerialNumberEntity } from '../entities/serial-number.entity';
import { EquipmentMovementService } from '../services/equipment-movement.service';
import { parseSmartFile, normalizeHeader } from '../../../common/utils/smart-file-parser.util';
import { SerialImportRowDto, ConfirmSerialsImportDto } from './dto/confirm-serials-import.dto';
import {
  CatalogOption,
  SerialImportField,
  SerialImportParsedRow,
  SerialImportRowAnalysis,
  SerialImportRowResult,
  SerialsImportAnalysisResult,
  SerialsImportConfirmResult,
} from './serials-import.types';

/**
 * Encabezados reconocidos para la recepción masiva de unidades serializadas
 * (ej. "llegaron 50 ONUs del mismo modelo"): una fila = una unidad física.
 */
const HEADER_FIELD_MAP: Record<string, SerialImportField> = {
  producto: 'producto',
  sku: 'producto',
  'sku/producto': 'producto',
  modelo: 'producto',
  articulo: 'producto',
  serial: 'serial',
  'numero de serie': 'serial',
  'número de serie': 'serial',
  'no. serie': 'serial',
  serie: 'serial',
  mac: 'mac',
  'direccion mac': 'mac',
  'mac address': 'mac',
  almacen: 'almacen',
  'almacen destino': 'almacen',
  'almacen de destino': 'almacen',
};

const MIN_RECOGNIZED_HEADERS = 2;

function buildProductIndex(products: ProductEntity[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const product of products) {
    for (const name of [product.sku, product.name]) {
      if (name && name.trim()) {
        const key = normalizeHeader(name);
        if (!index.has(key)) index.set(key, product.id);
      }
    }
  }
  return index;
}

function buildWarehouseIndex(warehouses: WarehouseEntity[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const warehouse of warehouses) {
    const key = normalizeHeader(warehouse.name);
    if (!index.has(key)) index.set(key, warehouse.id);
  }
  return index;
}

@Injectable()
export class SerialsImportService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(WarehouseEntity)
    private readonly warehouseRepository: Repository<WarehouseEntity>,
    @InjectRepository(SerialNumberEntity)
    private readonly serialRepository: Repository<SerialNumberEntity>,
    private readonly equipmentMovementService: EquipmentMovementService,
  ) {}

  async analyze(file: Express.Multer.File | undefined): Promise<SerialsImportAnalysisResult> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Debe adjuntar un archivo CSV o Excel (.xlsx) con al menos una fila de datos.');
    }

    const parseResult = await parseSmartFile<SerialImportField>(
      file.buffer,
      file.originalname,
      HEADER_FIELD_MAP,
      MIN_RECOGNIZED_HEADERS,
    );

    const [serializableProducts, warehouses] = await Promise.all([
      this.productRepository.find({ where: { requiresSerial: true } }),
      this.warehouseRepository.find({ where: { isActive: true } }),
    ]);

    const productIndex = buildProductIndex(serializableProducts);
    const warehouseIndex = buildWarehouseIndex(warehouses);

    const unresolvedProducts = new Set<string>();
    const unresolvedWarehouses = new Set<string>();

    const rows: SerialImportRowAnalysis[] = (parseResult.rows as SerialImportParsedRow[]).map((row) => {
      const errors: string[] = [];
      const productoText = (row.producto || '').trim();
      const serial = (row.serial || '').trim();
      const almacenText = (row.almacen || '').trim();

      if (!productoText) errors.push('Falta el producto (SKU o nombre)');
      if (!serial) errors.push('Falta el número de serie');

      const productResolved = !productoText || productIndex.has(normalizeHeader(productoText));
      if (productoText && !productResolved) unresolvedProducts.add(productoText);

      const warehouseResolved = !almacenText || warehouseIndex.has(normalizeHeader(almacenText));
      if (almacenText && !warehouseResolved) unresolvedWarehouses.add(almacenText);

      return { row, errors, productResolved, warehouseResolved };
    });

    // Serial/MAC duplicados dentro del mismo archivo.
    const seenSerials = new Set<string>();
    const seenMacs = new Set<string>();
    rows.forEach(({ row, errors }) => {
      const serial = (row.serial || '').trim();
      const mac = (row.mac || '').trim();
      if (serial) {
        if (seenSerials.has(serial.toUpperCase())) errors.push(`Serial "${serial}" repetido dentro del mismo archivo`);
        seenSerials.add(serial.toUpperCase());
      }
      if (mac) {
        if (seenMacs.has(mac.toUpperCase())) errors.push(`MAC "${mac}" repetida dentro del mismo archivo`);
        seenMacs.add(mac.toUpperCase());
      }
    });

    // Serial/MAC ya existentes en el sistema.
    const candidateSerials = rows.map(({ row }) => (row.serial || '').trim()).filter(Boolean);
    const candidateMacs = rows.map(({ row }) => (row.mac || '').trim()).filter(Boolean);
    if (candidateSerials.length > 0 || candidateMacs.length > 0) {
      const existing = await this.serialRepository.find({
        where: [
          ...(candidateSerials.length > 0 ? [{ serialNumber: In(candidateSerials) }] : []),
          ...(candidateMacs.length > 0 ? [{ macAddress: In(candidateMacs) }] : []),
        ],
      });
      const existingSerialSet = new Set(existing.map((e) => e.serialNumber.toUpperCase()));
      const existingMacSet = new Set(existing.filter((e) => e.macAddress).map((e) => (e.macAddress as string).toUpperCase()));
      rows.forEach(({ row, errors }) => {
        const serial = (row.serial || '').trim();
        const mac = (row.mac || '').trim();
        if (serial && existingSerialSet.has(serial.toUpperCase())) {
          errors.push(`El serial "${serial}" ya existe en el sistema`);
        }
        if (mac && existingMacSet.has(mac.toUpperCase())) {
          errors.push(`La MAC "${mac}" ya está registrada en el sistema`);
        }
      });
    }

    // "Válida" = sin errores duros Y con producto resuelto — el producto es
    // obligatorio para dar de alta la unidad (ingresarEquipo exige productId),
    // así que un producto sin reconocer también vuelve la fila no-importable
    // tal cual, aunque el usuario pueda resolverlo con un mapeo manual.
    const validRowsCount = rows.filter((r) => r.errors.length === 0 && r.productResolved).length;
    const existingProductOptions: CatalogOption[] = serializableProducts.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      requiresSerial: p.requiresSerial,
    }));

    return {
      recognizedColumns: parseResult.recognizedColumns,
      totalRows: rows.length,
      validRowsCount,
      invalidRowsCount: rows.length - validRowsCount,
      rows,
      unresolvedProducts: [...unresolvedProducts],
      unresolvedWarehouses: [...unresolvedWarehouses],
      existingProducts: existingProductOptions,
      existingWarehouses: warehouses.map((w) => ({ id: w.id, name: w.name })),
    };
  }

  async confirm(dto: ConfirmSerialsImportDto, userId: string): Promise<SerialsImportConfirmResult> {
    if (!dto.rows || dto.rows.length === 0) {
      throw new BadRequestException('No hay filas para importar.');
    }

    const [products, warehouses] = await Promise.all([
      this.productRepository.find({ where: { requiresSerial: true } }),
      this.warehouseRepository.find(),
    ]);
    const productIndex = buildProductIndex(products);
    const warehouseIndex = buildWarehouseIndex(warehouses);

    const results: SerialImportRowResult[] = [];
    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of dto.rows) {
      const result = await this.importOneRow(row, dto, productIndex, warehouseIndex, userId);
      results.push(result);
      if (result.status === 'created') created++;
      else if (result.status === 'skipped') skipped++;
      else failed++;
    }

    return { totalRows: dto.rows.length, created, skipped, failed, results };
  }

  private async importOneRow(
    row: SerialImportRowDto,
    dto: ConfirmSerialsImportDto,
    productIndex: Map<string, string>,
    warehouseIndex: Map<string, string>,
    userId: string,
  ): Promise<SerialImportRowResult> {
    const productoText = (row.producto || '').trim();
    const serial = (row.serial || '').trim();
    const mac = (row.mac || '').trim();
    const almacenText = (row.almacen || '').trim();

    if (!productoText || !serial) {
      return { rowNumber: row.rowNumber, status: 'skipped', message: 'Faltan campos obligatorios (producto o número de serie)' };
    }

    const productId = this.resolveMapping(productoText, dto.productMappings, productIndex);
    if (!productId) {
      return {
        rowNumber: row.rowNumber,
        status: 'skipped',
        message: `Producto "${productoText}" no reconocido — asígnelo a un producto serializable existente antes de confirmar`,
      };
    }

    const warehouseId = almacenText ? this.resolveMapping(almacenText, dto.warehouseMappings, warehouseIndex) : undefined;

    try {
      const equipment = await this.equipmentMovementService.ingresarEquipo(
        { productId, serialNumber: serial, macAddress: mac || undefined, warehouseId },
        userId,
      );
      return { rowNumber: row.rowNumber, status: 'created', equipmentId: equipment.id };
    } catch (err: any) {
      return { rowNumber: row.rowNumber, status: 'error', message: err?.message || 'Error desconocido al registrar el equipo' };
    }
  }

  private resolveMapping(rawText: string, manualMappings: Record<string, string> | undefined, autoIndex: Map<string, string>): string | undefined {
    if (manualMappings) {
      if (manualMappings[rawText]) return manualMappings[rawText];
      const normalized = normalizeHeader(rawText);
      if (manualMappings[normalized]) return manualMappings[normalized];
    }
    return autoIndex.get(normalizeHeader(rawText));
  }
}
