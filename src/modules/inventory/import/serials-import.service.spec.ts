import { BadRequestException } from '@nestjs/common';
import { SerialsImportService } from './serials-import.service';

describe('SerialsImportService', () => {
  let service: SerialsImportService;
  let productRepository: any;
  let warehouseRepository: any;
  let serialRepository: any;
  let equipmentMovementService: any;

  const serializableProducts = [
    { id: 'prod-onu', sku: 'ONU-100', name: 'ONU GPON XYZ', requiresSerial: true },
    { id: 'prod-router', sku: 'ROU-50', name: 'Router WiFi 6', requiresSerial: true },
  ];
  const warehouses = [{ id: 'wh-central', name: 'Almacén Central', isActive: true }];

  beforeEach(() => {
    productRepository = { find: jest.fn().mockResolvedValue(serializableProducts) };
    warehouseRepository = { find: jest.fn().mockResolvedValue(warehouses) };
    serialRepository = { find: jest.fn().mockResolvedValue([]) };
    equipmentMovementService = {
      ingresarEquipo: jest.fn().mockImplementation((input: any) => Promise.resolve({ id: `eq-${input.serialNumber}`, ...input })),
    };

    service = new SerialsImportService(productRepository, warehouseRepository, serialRepository, equipmentMovementService);
  });

  function buildFile(content: string): Express.Multer.File {
    return { buffer: Buffer.from(content, 'utf8'), originalname: 'unidades.csv' } as Express.Multer.File;
  }

  describe('analyze', () => {
    it('lanza BadRequestException si no se adjunta archivo', async () => {
      await expect(service.analyze(undefined)).rejects.toThrow(BadRequestException);
    });

    it('reconoce el producto por SKU y resuelve correctamente serial/MAC/almacén', async () => {
      const file = buildFile('Producto,Serial,MAC,Almacen\n' + 'ONU-100,SN-001,AA:BB:CC:DD:EE:01,Almacén Central');

      const result = await service.analyze(file);

      expect(result.totalRows).toBe(1);
      expect(result.validRowsCount).toBe(1);
      expect(result.rows[0].productResolved).toBe(true);
      expect(result.rows[0].warehouseResolved).toBe(true);
      expect(result.rows[0].errors).toEqual([]);
    });

    it('reconoce el producto por nombre (no solo por SKU)', async () => {
      const file = buildFile('Producto,Serial\n' + 'ONU GPON XYZ,SN-001');

      const result = await service.analyze(file);

      expect(result.rows[0].productResolved).toBe(true);
    });

    it('marca como no resuelto un producto que no existe o no requiere serial', async () => {
      const file = buildFile('Producto,Serial\n' + 'Cable UTP,SN-001');

      const result = await service.analyze(file);

      expect(result.rows[0].productResolved).toBe(false);
      expect(result.unresolvedProducts).toEqual(['Cable UTP']);
    });

    it('fila sin producto o sin serial reporta el error correspondiente', async () => {
      const file = buildFile('Producto,Serial\n' + ',');

      const result = await service.analyze(file);

      expect(result.rows[0].errors).toEqual(
        expect.arrayContaining(['Falta el producto (SKU o nombre)', 'Falta el número de serie']),
      );
    });

    it('detecta serial duplicado dentro del mismo archivo', async () => {
      const file = buildFile('Producto,Serial\n' + 'ONU-100,SN-001\n' + 'ONU-100,SN-001');

      const result = await service.analyze(file);

      expect(result.rows[1].errors).toEqual(expect.arrayContaining([expect.stringContaining('repetido dentro del mismo archivo')]));
    });

    it('detecta MAC duplicada dentro del mismo archivo', async () => {
      const file = buildFile('Producto,Serial,MAC\n' + 'ONU-100,SN-001,AA:BB:CC\n' + 'ONU-100,SN-002,AA:BB:CC');

      const result = await service.analyze(file);

      expect(result.rows[1].errors).toEqual(expect.arrayContaining([expect.stringContaining('MAC "AA:BB:CC" repetida')]));
    });

    it('detecta serial que ya existe en el sistema', async () => {
      serialRepository.find.mockResolvedValue([{ serialNumber: 'SN-001', macAddress: null }]);
      const file = buildFile('Producto,Serial\n' + 'ONU-100,SN-001');

      const result = await service.analyze(file);

      expect(result.rows[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('ya existe en el sistema')]));
    });

    it('detecta MAC que ya está registrada en el sistema', async () => {
      serialRepository.find.mockResolvedValue([{ serialNumber: 'SN-OTRO', macAddress: 'AA:BB:CC' }]);
      const file = buildFile('Producto,Serial,MAC\n' + 'ONU-100,SN-001,AA:BB:CC');

      const result = await service.analyze(file);

      expect(result.rows[0].errors).toEqual(expect.arrayContaining([expect.stringContaining('ya está registrada')]));
    });

    it('MAC es opcional (ej. herramientas): una fila sin MAC no genera error', async () => {
      const file = buildFile('Producto,Serial\n' + 'ONU-100,SN-001');

      const result = await service.analyze(file);

      expect(result.rows[0].errors).toEqual([]);
    });
  });

  describe('confirm', () => {
    it('lanza BadRequestException si no hay filas', async () => {
      await expect(service.confirm({ rows: [] } as any, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('da de alta una unidad serializada llamando a EquipmentMovementService.ingresarEquipo', async () => {
      const result = await service.confirm(
        { rows: [{ rowNumber: 2, producto: 'ONU-100', serial: 'SN-001', mac: 'AA:BB:CC:DD:EE:01', almacen: 'Almacén Central' }] } as any,
        'user-1',
      );

      expect(result.created).toBe(1);
      expect(equipmentMovementService.ingresarEquipo).toHaveBeenCalledWith(
        { productId: 'prod-onu', serialNumber: 'SN-001', macAddress: 'AA:BB:CC:DD:EE:01', warehouseId: 'wh-central' },
        'user-1',
      );
      expect(result.results[0]).toEqual({ rowNumber: 2, status: 'created', equipmentId: 'eq-SN-001' });
    });

    it('da de alta correctamente un lote de varias unidades del mismo producto (caso real: N ONUs)', async () => {
      const result = await service.confirm(
        {
          rows: [
            { rowNumber: 2, producto: 'ONU-100', serial: 'SN-001', mac: 'AA:00:00:00:00:01' },
            { rowNumber: 3, producto: 'ONU-100', serial: 'SN-002', mac: 'AA:00:00:00:00:02' },
            { rowNumber: 4, producto: 'ONU-100', serial: 'SN-003', mac: 'AA:00:00:00:00:03' },
          ],
        } as any,
        'user-1',
      );

      expect(result.totalRows).toBe(3);
      expect(result.created).toBe(3);
      expect(equipmentMovementService.ingresarEquipo).toHaveBeenCalledTimes(3);
    });

    it('MAC es opcional en confirm (ej. herramientas sin MAC)', async () => {
      const result = await service.confirm({ rows: [{ rowNumber: 2, producto: 'ONU-100', serial: 'SN-001' }] } as any, 'user-1');

      expect(result.created).toBe(1);
      expect(equipmentMovementService.ingresarEquipo).toHaveBeenCalledWith(
        { productId: 'prod-onu', serialNumber: 'SN-001', macAddress: undefined, warehouseId: undefined },
        'user-1',
      );
    });

    it('omite (skipped) una fila con producto no reconocido y sin mapeo manual', async () => {
      const result = await service.confirm({ rows: [{ rowNumber: 2, producto: 'Cable UTP', serial: 'SN-001' }] } as any, 'user-1');

      expect(result.skipped).toBe(1);
      expect(result.results[0].message).toContain('Cable UTP');
      expect(equipmentMovementService.ingresarEquipo).not.toHaveBeenCalled();
    });

    it('resuelve un producto antes no reconocido usando productMappings', async () => {
      const result = await service.confirm(
        {
          rows: [{ rowNumber: 2, producto: 'Cable UTP', serial: 'SN-001' }],
          productMappings: { 'Cable UTP': 'prod-router' },
        } as any,
        'user-1',
      );

      expect(result.created).toBe(1);
      expect(equipmentMovementService.ingresarEquipo).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 'prod-router' }),
        'user-1',
      );
    });

    it('omite (skipped) una fila sin producto o sin serial sin llegar al servicio de equipos', async () => {
      const result = await service.confirm({ rows: [{ rowNumber: 2, producto: '', serial: '' }] } as any, 'user-1');

      expect(result.skipped).toBe(1);
      expect(equipmentMovementService.ingresarEquipo).not.toHaveBeenCalled();
    });

    it('un error de ingresarEquipo (ej. serial duplicado detectado en el momento) se reporta como error de fila sin abortar el resto del lote', async () => {
      equipmentMovementService.ingresarEquipo
        .mockRejectedValueOnce(new Error('El serial SN-001 ya existe en el sistema'))
        .mockImplementationOnce((input: any) => Promise.resolve({ id: `eq-${input.serialNumber}`, ...input }));

      const result = await service.confirm(
        {
          rows: [
            { rowNumber: 2, producto: 'ONU-100', serial: 'SN-001' },
            { rowNumber: 3, producto: 'ONU-100', serial: 'SN-002' },
          ],
        } as any,
        'user-1',
      );

      expect(result.failed).toBe(1);
      expect(result.created).toBe(1);
      expect(result.results[0]).toEqual({ rowNumber: 2, status: 'error', message: 'El serial SN-001 ya existe en el sistema' });
      expect(result.results[1].status).toBe('created');
    });
  });
});
