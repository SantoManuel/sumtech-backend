import { BadRequestException } from '@nestjs/common';
import { ProductsImportService } from './products-import.service';

describe('ProductsImportService', () => {
  let service: ProductsImportService;
  let productRepository: any;
  let categoryRepository: any;
  let supplierRepository: any;
  let warehouseRepository: any;
  let inventoryService: any;

  const categories = [{ id: 'cat-onu', name: 'ONU', isActive: true }, { id: 'cat-router', name: 'Router', isActive: true }];
  const suppliers = [{ id: 'sup-huawei', businessName: 'Huawei Dominicana SRL', tradeName: 'Huawei RD', isActive: true }];
  const warehouses = [{ id: 'wh-central', name: 'Almacén Central', isActive: true }];

  beforeEach(() => {
    productRepository = { find: jest.fn().mockResolvedValue([]) };
    categoryRepository = { find: jest.fn().mockResolvedValue(categories) };
    supplierRepository = { find: jest.fn().mockResolvedValue(suppliers) };
    warehouseRepository = { find: jest.fn().mockResolvedValue(warehouses) };
    inventoryService = {
      createProduct: jest.fn().mockImplementation((dto) => Promise.resolve({ id: `prod-${dto.sku}`, ...dto })),
    };

    service = new ProductsImportService(productRepository, categoryRepository, supplierRepository, warehouseRepository, inventoryService);
  });

  function buildFile(content: string): Express.Multer.File {
    return { buffer: Buffer.from(content, 'utf8'), originalname: 'productos.csv' } as Express.Multer.File;
  }

  describe('analyze', () => {
    it('lanza BadRequestException si no se adjunta archivo', async () => {
      await expect(service.analyze(undefined)).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el archivo está vacío', async () => {
      await expect(service.analyze({ buffer: Buffer.alloc(0), originalname: 'vacio.csv' } as any)).rejects.toThrow(BadRequestException);
    });

    it('reconoce columnas por nombre y resuelve categoría/proveedor/almacén existentes', async () => {
      const file = buildFile(
        'Nombre,SKU,Categoria,Proveedor,Marca,Modelo,Precio Costo,Almacen\n' +
          'ONU GPON XYZ,ONU-100,ONU,Huawei RD,Huawei,HG8145V5,1500.00,Almacén Central',
      );

      const result = await service.analyze(file);

      expect(result.totalRows).toBe(1);
      expect(result.validRowsCount).toBe(1);
      expect(result.invalidRowsCount).toBe(0);
      expect(result.rows[0].categoryResolved).toBe(true);
      expect(result.rows[0].supplierResolved).toBe(true);
      expect(result.rows[0].warehouseResolved).toBe(true);
      expect(result.rows[0].errors).toEqual([]);
      expect(result.existingCategories).toEqual([{ id: 'cat-onu', name: 'ONU' }, { id: 'cat-router', name: 'Router' }]);
    });

    it('marca como no resuelta una categoría que no existe en el catálogo', async () => {
      const file = buildFile(
        'Nombre,SKU,Categoria,Marca,Modelo,Precio Costo\n' + 'Decodificador X,DEC-1,Decodificadores,TP-Link,X100,900',
      );

      const result = await service.analyze(file);

      expect(result.rows[0].categoryResolved).toBe(false);
      expect(result.unresolvedCategories).toEqual(['Decodificadores']);
    });

    it('fila sin nombre/sku/marca/modelo/categoría acumula un error por cada campo faltante', async () => {
      const file = buildFile('Nombre,SKU,Categoria,Marca,Modelo,Precio Costo\n' + ',,,,,100');

      const result = await service.analyze(file);

      expect(result.rows[0].errors).toEqual(
        expect.arrayContaining([
          'Falta el nombre del producto',
          'Falta el SKU/código',
          'Falta la marca',
          'Falta el modelo',
          'Falta la categoría',
        ]),
      );
      expect(result.validRowsCount).toBe(0);
    });

    it('detecta SKU duplicado dentro del mismo archivo', async () => {
      const file = buildFile(
        'Nombre,SKU,Categoria,Marca,Modelo,Precio Costo\n' +
          'ONU A,ONU-1,ONU,Huawei,HG1,500\n' +
          'ONU B (otro nombre),ONU-1,ONU,Huawei,HG2,600',
      );

      const result = await service.analyze(file);

      expect(result.rows[1].errors).toEqual(expect.arrayContaining([expect.stringContaining('repetido dentro del mismo archivo')]));
    });

    it('detecta SKU que ya existe en el catálogo actual', async () => {
      productRepository.find.mockResolvedValue([{ id: 'prod-x', sku: 'ONU-100' }]);
      const file = buildFile('Nombre,SKU,Categoria,Marca,Modelo,Precio Costo\n' + 'ONU Repetida,ONU-100,ONU,Huawei,HG1,500');

      const result = await service.analyze(file);

      expect(result.rows[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('Ya existe un producto con el SKU "ONU-100"')]));
    });

    it('tolera tildes/mayúsculas en el nombre de categoría al resolver', async () => {
      const file = buildFile('Nombre,SKU,Categoria,Marca,Modelo,Precio Costo\n' + 'ONU A,ONU-1,  oNu  ,Huawei,HG1,500');

      const result = await service.analyze(file);

      expect(result.rows[0].categoryResolved).toBe(true);
    });

    it('lanza BadRequestException si no se reconocen suficientes columnas', async () => {
      const file = buildFile('ColumnaX,ColumnaY\nvalor1,valor2');
      await expect(service.analyze(file)).rejects.toThrow(BadRequestException);
    });
  });

  describe('confirm', () => {
    it('lanza BadRequestException si no hay filas', async () => {
      await expect(service.confirm({ rows: [] } as any)).rejects.toThrow(BadRequestException);
    });

    it('crea un producto válido llamando a InventoryService.createProduct con los datos resueltos', async () => {
      const result = await service.confirm({
        rows: [
          {
            rowNumber: 2,
            nombre: 'ONU GPON XYZ',
            sku: 'ONU-100',
            categoria: 'ONU',
            proveedor: 'Huawei RD',
            marca: 'Huawei',
            modelo: 'HG8145V5',
            precioCosto: '1,500.00',
            almacen: 'Almacén Central',
            requiereSerial: 'Si',
          },
        ],
      } as any);

      expect(result.created).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(inventoryService.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          sku: 'ONU-100',
          name: 'ONU GPON XYZ',
          categoryId: 'cat-onu',
          supplierId: 'sup-huawei',
          defaultWarehouseId: 'wh-central',
          brand: 'Huawei',
          model: 'HG8145V5',
          costPrice: 1500,
          requiresSerial: true,
        }),
      );
      expect(result.results[0]).toEqual({ rowNumber: 2, status: 'created', productId: 'prod-ONU-100' });
    });

    it('omite (skipped) una fila con categoría no resuelta y sin mapeo manual', async () => {
      const result = await service.confirm({
        rows: [{ rowNumber: 2, nombre: 'Decodificador', sku: 'DEC-1', categoria: 'Decodificadores', marca: 'TP-Link', modelo: 'X1', precioCosto: '900' }],
      } as any);

      expect(result.skipped).toBe(1);
      expect(result.results[0].status).toBe('skipped');
      expect(result.results[0].message).toContain('Decodificadores');
      expect(inventoryService.createProduct).not.toHaveBeenCalled();
    });

    it('resuelve una categoría antes no reconocida usando categoryMappings', async () => {
      const result = await service.confirm({
        rows: [{ rowNumber: 2, nombre: 'Decodificador', sku: 'DEC-1', categoria: 'Decodificadores', marca: 'TP-Link', modelo: 'X1', precioCosto: '900' }],
        categoryMappings: { Decodificadores: 'cat-router' },
      } as any);

      expect(result.created).toBe(1);
      expect(inventoryService.createProduct).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat-router' }));
    });

    it('omite (skipped) una fila con campos obligatorios faltantes sin llegar a InventoryService', async () => {
      const result = await service.confirm({
        rows: [{ rowNumber: 2, nombre: '', sku: 'DEC-1', categoria: 'ONU', marca: 'TP-Link', modelo: 'X1', precioCosto: '900' }],
      } as any);

      expect(result.skipped).toBe(1);
      expect(inventoryService.createProduct).not.toHaveBeenCalled();
    });

    it('un error de InventoryService.createProduct (ej. SKU duplicado en carrera) se reporta como error de fila sin abortar el resto del lote', async () => {
      inventoryService.createProduct
        .mockRejectedValueOnce(new Error('Ya existe un producto con el SKU "ONU-1"'))
        .mockImplementationOnce((dto: any) => Promise.resolve({ id: `prod-${dto.sku}`, ...dto }));

      const result = await service.confirm({
        rows: [
          { rowNumber: 2, nombre: 'ONU A', sku: 'ONU-1', categoria: 'ONU', marca: 'Huawei', modelo: 'HG1', precioCosto: '500' },
          { rowNumber: 3, nombre: 'ONU B', sku: 'ONU-2', categoria: 'ONU', marca: 'Huawei', modelo: 'HG2', precioCosto: '600' },
        ],
      } as any);

      expect(result.failed).toBe(1);
      expect(result.created).toBe(1);
      expect(result.results[0]).toEqual({ rowNumber: 2, status: 'error', message: 'Ya existe un producto con el SKU "ONU-1"' });
      expect(result.results[1].status).toBe('created');
    });

    it('sin stockMinimo/precioVenta/unidadMedida usa los defaults razonables', async () => {
      await service.confirm({
        rows: [{ rowNumber: 2, nombre: 'ONU A', sku: 'ONU-1', categoria: 'ONU', marca: 'Huawei', modelo: 'HG1', precioCosto: '500' }],
      } as any);

      expect(inventoryService.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ stockMinimum: 10, salePrice: undefined, unitOfMeasure: undefined }),
      );
    });
  });
});
