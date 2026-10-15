import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProductEntity } from '../entities/product.entity';
import { CategoryEntity } from '../entities/category.entity';
import { SupplierEntity } from '../entities/supplier.entity';
import { WarehouseEntity } from '../entities/warehouse.entity';
import { InventoryService } from '../inventory.service';
import { CreateProductDto } from '../dto/create-product.dto';
import { ConfirmProductsImportDto, ProductImportRowDto } from './dto/confirm-products-import.dto';
import { parseSmartFile, normalizeHeader, parseMoneyAmount, parseYesNo } from '../../../common/utils/smart-file-parser.util';
import {
  ProductImportField,
  ProductImportParsedRow,
  ProductImportRowAnalysis,
  ProductImportRowResult,
  ProductsImportAnalysisResult,
  ProductsImportConfirmResult,
} from './products-import.types';

/**
 * Encabezados reconocidos para la carga masiva de catálogo (productos/SKU).
 * Sinónimos en español comunes en exports de distintos sistemas/hojas de cálculo.
 */
const HEADER_FIELD_MAP: Record<string, ProductImportField> = {
  nombre: 'nombre',
  'nombre del producto': 'nombre',
  'nombre del articulo': 'nombre',
  articulo: 'nombre',
  producto: 'nombre',
  sku: 'sku',
  codigo: 'sku',
  'codigo interno': 'sku',
  'sku/codigo': 'sku',
  'sku / codigo': 'sku',
  categoria: 'categoria',
  proveedor: 'proveedor',
  marca: 'marca',
  fabricante: 'marca',
  modelo: 'modelo',
  'precio costo': 'precioCosto',
  'precio de costo': 'precioCosto',
  costo: 'precioCosto',
  'costo unitario': 'precioCosto',
  'precio venta': 'precioVenta',
  'precio de venta': 'precioVenta',
  precio: 'precioVenta',
  'unidad de medida': 'unidadMedida',
  unidad: 'unidadMedida',
  'stock minimo': 'stockMinimo',
  'cantidad minima': 'stockMinimo',
  'stock de seguridad': 'stockMinimo',
  almacen: 'almacen',
  'almacen por defecto': 'almacen',
  'almacen default': 'almacen',
  'almacen destino': 'almacen',
  'requiere serial': 'requiereSerial',
  'requiere numero de serie': 'requiereSerial',
  serializado: 'requiereSerial',
  descripcion: 'descripcion',
};

const MIN_RECOGNIZED_HEADERS = 3;

/** Índice normalizado nombre->id para resolver texto libre del archivo contra catálogo ya existente. */
function buildNameIndex(entries: Array<{ id: string; names: Array<string | undefined> }>): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of entries) {
    for (const name of entry.names) {
      if (name && name.trim()) {
        const key = normalizeHeader(name);
        if (!index.has(key)) index.set(key, entry.id);
      }
    }
  }
  return index;
}

@Injectable()
export class ProductsImportService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
    @InjectRepository(SupplierEntity)
    private readonly supplierRepository: Repository<SupplierEntity>,
    @InjectRepository(WarehouseEntity)
    private readonly warehouseRepository: Repository<WarehouseEntity>,
    private readonly inventoryService: InventoryService,
  ) {}

  async analyze(file: Express.Multer.File | undefined): Promise<ProductsImportAnalysisResult> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Debe adjuntar un archivo CSV o Excel (.xlsx) con al menos una fila de datos.');
    }

    const parseResult = await parseSmartFile<ProductImportField>(
      file.buffer,
      file.originalname,
      HEADER_FIELD_MAP,
      MIN_RECOGNIZED_HEADERS,
    );

    const [categories, suppliers, warehouses] = await Promise.all([
      this.categoryRepository.find({ where: { isActive: true } }),
      this.supplierRepository.find({ where: { isActive: true } }),
      this.warehouseRepository.find({ where: { isActive: true } }),
    ]);

    const categoryIndex = buildNameIndex(categories.map((c) => ({ id: c.id, names: [c.name] })));
    const supplierIndex = buildNameIndex(suppliers.map((s) => ({ id: s.id, names: [s.businessName, s.tradeName] })));
    const warehouseIndex = buildNameIndex(warehouses.map((w) => ({ id: w.id, names: [w.name] })));

    const unresolvedCategories = new Set<string>();
    const unresolvedSuppliers = new Set<string>();
    const unresolvedWarehouses = new Set<string>();

    const rows: ProductImportRowAnalysis[] = (parseResult.rows as ProductImportParsedRow[]).map((row) => {
      const errors: string[] = [];
      const nombre = (row.nombre || '').trim();
      const sku = (row.sku || '').trim();
      const marca = (row.marca || '').trim();
      const modelo = (row.modelo || '').trim();
      const categoriaText = (row.categoria || '').trim();
      const proveedorText = (row.proveedor || '').trim();
      const almacenText = (row.almacen || '').trim();

      if (!nombre) errors.push('Falta el nombre del producto');
      if (!sku) errors.push('Falta el SKU/código');
      if (!marca) errors.push('Falta la marca');
      if (!modelo) errors.push('Falta el modelo');
      if (!categoriaText) errors.push('Falta la categoría');

      const categoryResolved = !categoriaText || categoryIndex.has(normalizeHeader(categoriaText));
      if (categoriaText && !categoryResolved) unresolvedCategories.add(categoriaText);

      const supplierResolved = !proveedorText || supplierIndex.has(normalizeHeader(proveedorText));
      if (proveedorText && !supplierResolved) unresolvedSuppliers.add(proveedorText);

      const warehouseResolved = !almacenText || warehouseIndex.has(normalizeHeader(almacenText));
      if (almacenText && !warehouseResolved) unresolvedWarehouses.add(almacenText);

      return { row, errors, categoryResolved, supplierResolved, warehouseResolved };
    });

    // SKU duplicado dentro del mismo archivo.
    const seenSkus = new Set<string>();
    rows.forEach(({ row, errors }) => {
      const sku = (row.sku || '').trim();
      if (sku) {
        if (seenSkus.has(sku.toUpperCase())) {
          errors.push(`SKU "${sku}" repetido dentro del mismo archivo`);
        }
        seenSkus.add(sku.toUpperCase());
      }
    });

    // SKU ya existente en el catálogo actual.
    const candidateSkus = rows.map(({ row }) => (row.sku || '').trim()).filter(Boolean);
    if (candidateSkus.length > 0) {
      const existing = await this.productRepository.find({ where: { sku: In(candidateSkus) } });
      const existingSkuSet = new Set(existing.map((p) => p.sku.toUpperCase()));
      rows.forEach(({ row, errors }) => {
        const sku = (row.sku || '').trim();
        if (sku && existingSkuSet.has(sku.toUpperCase())) {
          errors.push(`Ya existe un producto con el SKU "${sku}"`);
        }
      });
    }

    // "Válida" = sin errores duros Y con categoría resuelta — la categoría es
    // obligatoria para crear el producto (CreateProductDto.categoryId no es
    // opcional), así que una categoría sin reconocer también vuelve la fila
    // no-importable tal cual, aunque técnicamente no sea un "error" bloqueante
    // (el usuario puede resolverla con un mapeo manual antes de confirmar).
    const validRowsCount = rows.filter((r) => r.errors.length === 0 && r.categoryResolved).length;

    return {
      recognizedColumns: parseResult.recognizedColumns,
      totalRows: rows.length,
      validRowsCount,
      invalidRowsCount: rows.length - validRowsCount,
      rows,
      unresolvedCategories: [...unresolvedCategories],
      unresolvedSuppliers: [...unresolvedSuppliers],
      unresolvedWarehouses: [...unresolvedWarehouses],
      existingCategories: categories.map((c) => ({ id: c.id, name: c.name })),
      existingSuppliers: suppliers.map((s) => ({ id: s.id, name: s.tradeName || s.businessName })),
      existingWarehouses: warehouses.map((w) => ({ id: w.id, name: w.name })),
    };
  }

  async confirm(dto: ConfirmProductsImportDto): Promise<ProductsImportConfirmResult> {
    if (!dto.rows || dto.rows.length === 0) {
      throw new BadRequestException('No hay filas para importar.');
    }

    const [categories, suppliers, warehouses] = await Promise.all([
      this.categoryRepository.find(),
      this.supplierRepository.find(),
      this.warehouseRepository.find(),
    ]);
    const categoryIndex = buildNameIndex(categories.map((c) => ({ id: c.id, names: [c.name] })));
    const supplierIndex = buildNameIndex(suppliers.map((s) => ({ id: s.id, names: [s.businessName, s.tradeName] })));
    const warehouseIndex = buildNameIndex(warehouses.map((w) => ({ id: w.id, names: [w.name] })));

    const results: ProductImportRowResult[] = [];
    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of dto.rows) {
      const result = await this.importOneRow(row, dto, categoryIndex, supplierIndex, warehouseIndex);
      results.push(result);
      if (result.status === 'created') created++;
      else if (result.status === 'skipped') skipped++;
      else failed++;
    }

    return { totalRows: dto.rows.length, created, skipped, failed, results };
  }

  private async importOneRow(
    row: ProductImportRowDto,
    dto: ConfirmProductsImportDto,
    categoryIndex: Map<string, string>,
    supplierIndex: Map<string, string>,
    warehouseIndex: Map<string, string>,
  ): Promise<ProductImportRowResult> {
    const nombre = (row.nombre || '').trim();
    const sku = (row.sku || '').trim();
    const marca = (row.marca || '').trim();
    const modelo = (row.modelo || '').trim();
    const categoriaText = (row.categoria || '').trim();

    if (!nombre || !sku || !marca || !modelo || !categoriaText) {
      return {
        rowNumber: row.rowNumber,
        status: 'skipped',
        message: 'Faltan campos obligatorios (nombre, SKU, marca, modelo o categoría)',
      };
    }

    const categoryId = this.resolveMapping(categoriaText, dto.categoryMappings, categoryIndex);
    if (!categoryId) {
      return {
        rowNumber: row.rowNumber,
        status: 'skipped',
        message: `Categoría "${categoriaText}" no reconocida — asígnele una categoría existente antes de confirmar`,
      };
    }

    const proveedorText = (row.proveedor || '').trim();
    const supplierId = proveedorText ? this.resolveMapping(proveedorText, dto.supplierMappings, supplierIndex) : undefined;

    const almacenText = (row.almacen || '').trim();
    const defaultWarehouseId = almacenText ? this.resolveMapping(almacenText, dto.warehouseMappings, warehouseIndex) : undefined;

    const createDto: CreateProductDto = {
      sku,
      name: nombre,
      categoryId,
      supplierId,
      defaultWarehouseId,
      brand: marca,
      model: modelo,
      unitOfMeasure: (row.unidadMedida || '').trim() || undefined,
      description: (row.descripcion || '').trim() || undefined,
      costPrice: parseMoneyAmount(row.precioCosto),
      salePrice: row.precioVenta ? parseMoneyAmount(row.precioVenta) : undefined,
      stockMinimum: row.stockMinimo ? Math.max(0, Math.round(parseMoneyAmount(row.stockMinimo))) : 10,
      requiresSerial:
        row.requiereSerial !== undefined && row.requiereSerial.trim() !== '' ? parseYesNo(row.requiereSerial, true) : undefined,
    };

    try {
      const product = await this.inventoryService.createProduct(createDto);
      return { rowNumber: row.rowNumber, status: 'created', productId: product.id };
    } catch (err: any) {
      return { rowNumber: row.rowNumber, status: 'error', message: err?.message || 'Error desconocido al crear el producto' };
    }
  }

  /** Prioriza el mapeo manual provisto en confirm() (por texto crudo o normalizado) sobre el match automático. */
  private resolveMapping(rawText: string, manualMappings: Record<string, string> | undefined, autoIndex: Map<string, string>): string | undefined {
    if (manualMappings) {
      if (manualMappings[rawText]) return manualMappings[rawText];
      const normalized = normalizeHeader(rawText);
      if (manualMappings[normalized]) return manualMappings[normalized];
    }
    return autoIndex.get(normalizeHeader(rawText));
  }
}
