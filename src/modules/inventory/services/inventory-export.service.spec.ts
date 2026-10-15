import { BadRequestException } from '@nestjs/common';
import { InventoryExportService } from './inventory-export.service';
import { EquipmentLocationType, EquipmentCondition } from '../enums/equipment.enums';

describe('InventoryExportService', () => {
  let service: InventoryExportService;
  let serialRepository: any;
  let warehouseRepository: any;
  let categoryRepository: any;
  let supplierRepository: any;
  let equipmentMovementService: any;
  let pdfGenerator: any;
  let companyService: any;

  const makeEquipment = (overrides: Record<string, any> = {}) => ({
    id: 'eq-1',
    serialNumber: 'SN-001',
    macAddress: 'AA:BB:CC:DD:EE:FF',
    locationType: EquipmentLocationType.WAREHOUSE,
    condition: EquipmentCondition.NEW,
    assignedAt: new Date('2026-01-15T00:00:00Z'),
    product: {
      name: 'ONU GPON XYZ',
      sku: 'ONU-100',
      brand: 'Huawei',
      model: 'HG8145V5',
      category: { name: 'ONU' },
      supplier: { businessName: 'Proveedor Huawei SRL', tradeName: 'Huawei RD' },
    },
    currentWarehouse: { name: 'Almacén Central' },
    currentEmployee: undefined,
    client: undefined,
    ...overrides,
  });

  beforeEach(() => {
    serialRepository = {};
    warehouseRepository = { findOneBy: jest.fn().mockResolvedValue({ id: 'wh-1', name: 'Almacén Central' }) };
    categoryRepository = { findOneBy: jest.fn().mockResolvedValue({ id: 'cat-1', name: 'ONU' }) };
    supplierRepository = { findOneBy: jest.fn().mockResolvedValue({ id: 'sup-1', businessName: 'Proveedor Huawei SRL' }) };
    equipmentMovementService = { exportEquipment: jest.fn().mockResolvedValue([makeEquipment()]) };
    pdfGenerator = { generateEquipmentListPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-FAKE')) };
    companyService = {
      getCompanyFiscalInfo: jest.fn().mockResolvedValue({
        rnc: '131000000',
        razonSocial: 'SUMTECH TELECOM S.R.L.',
        nombreComercial: 'SUMTECH',
        direccion: 'Santo Domingo',
        telefono: '809-000-0000',
        correo: 'info@sumtech.do',
      }),
    };

    service = new InventoryExportService(
      serialRepository,
      warehouseRepository,
      categoryRepository,
      supplierRepository,
      equipmentMovementService,
      pdfGenerator,
      companyService,
    );
  });

  describe('export (CSV)', () => {
    it('genera un buffer CSV con BOM y encabezados correctos', async () => {
      const result = await service.export({ format: 'csv', limit: 100 } as any, 'cajero1');

      expect(result.contentType).toBe('text/csv; charset=utf-8');
      expect(result.filename).toMatch(/^equipos_\d{8}_\d{4}\.csv$/);
      const text = result.buffer.toString('utf8');
      expect(text).toContain('Serial');
      expect(text).toContain('SN-001');
      expect(text).toContain('ONU GPON XYZ');
      expect(text).toContain('ONU-100');
      expect(text).toContain('Proveedor Huawei SRL');
      expect(result.totalExportado).toBe(1);
    });

    it('respeta el límite solicitado (no exporta más filas de las pedidas)', async () => {
      equipmentMovementService.exportEquipment.mockResolvedValue([makeEquipment({ id: 'eq-1' }), makeEquipment({ id: 'eq-2' })]);

      const result = await service.export({ format: 'csv', limit: 1 } as any, 'cajero1');

      expect(result.totalExportado).toBe(1);
    });

    it('fila sin MAC (herramienta TOOL_ASSET) se exporta con la celda vacía, no revienta', async () => {
      equipmentMovementService.exportEquipment.mockResolvedValue([makeEquipment({ macAddress: null })]);

      const result = await service.export({ format: 'csv', limit: 100 } as any, 'cajero1');

      const text = result.buffer.toString('utf8');
      expect(text).toContain('SN-001');
    });

    it('sin resultados exporta solo el encabezado, no lanza', async () => {
      equipmentMovementService.exportEquipment.mockResolvedValue([]);

      const result = await service.export({ format: 'csv', limit: 100 } as any, 'cajero1');

      expect(result.totalExportado).toBe(0);
      expect(result.buffer.toString('utf8')).toContain('Serial');
    });
  });

  describe('export (PDF)', () => {
    it('genera el PDF usando la info fiscal real de CompanyService', async () => {
      const result = await service.export({ format: 'pdf', limit: 100 } as any, 'cajero1');

      expect(result.contentType).toBe('application/pdf');
      expect(result.filename).toMatch(/^equipos_\d{8}_\d{4}\.pdf$/);
      expect(pdfGenerator.generateEquipmentListPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          company: expect.objectContaining({ rnc: '131000000', razonSocial: 'SUMTECH TELECOM S.R.L.' }),
          totalExportado: 1,
          generatedByUsername: 'cajero1',
        }),
      );
    });

    it('rechaza con BadRequestException si se pide más del tope permitido para PDF', async () => {
      await expect(service.export({ format: 'pdf', limit: 5000 } as any, 'cajero1')).rejects.toThrow(BadRequestException);
      expect(equipmentMovementService.exportEquipment).not.toHaveBeenCalled();
    });

    it('usa un fallback de empresa si CompanyService no está disponible', async () => {
      const serviceSinCompany = new InventoryExportService(
        serialRepository,
        warehouseRepository,
        categoryRepository,
        supplierRepository,
        equipmentMovementService,
        pdfGenerator,
        undefined,
      );

      await serviceSinCompany.export({ format: 'pdf', limit: 100 } as any, 'cajero1');

      expect(pdfGenerator.generateEquipmentListPdf).toHaveBeenCalledWith(
        expect.objectContaining({ company: expect.objectContaining({ razonSocial: 'Sumtech' }) }),
      );
    });
  });

  describe('buildFiltersSummary (vía PDF)', () => {
    it('resuelve nombres reales de almacén/categoría/proveedor en el resumen de filtros', async () => {
      await service.export({ format: 'pdf', limit: 100, warehouseId: 'wh-1', categoryId: 'cat-1', supplierId: 'sup-1' } as any, 'cajero1');

      const callArg = pdfGenerator.generateEquipmentListPdf.mock.calls[0][0];
      expect(callArg.filtersSummary).toContain('Almacén: Almacén Central');
      expect(callArg.filtersSummary).toContain('Categoría: ONU');
      expect(callArg.filtersSummary).toContain('Proveedor: Proveedor Huawei SRL');
    });

    it('devuelve "Ninguno" cuando no hay filtros aplicados', async () => {
      await service.export({ format: 'pdf', limit: 100 } as any, 'cajero1');

      const callArg = pdfGenerator.generateEquipmentListPdf.mock.calls[0][0];
      expect(callArg.filtersSummary).toBe('Ninguno');
    });

    it('usa el UUID crudo si el almacén filtrado ya no existe', async () => {
      warehouseRepository.findOneBy.mockResolvedValue(null);

      await service.export({ format: 'pdf', limit: 100, warehouseId: 'wh-borrado' } as any, 'cajero1');

      const callArg = pdfGenerator.generateEquipmentListPdf.mock.calls[0][0];
      expect(callArg.filtersSummary).toContain('wh-borrado');
    });
  });
});
