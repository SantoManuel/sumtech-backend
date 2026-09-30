import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ClientsImportService, CLIENTS_IMPORT_QUEUE } from './clients-import.service';
import { ClientImportBatchEntity } from '../entities/client-import-batch.entity';
import { ClientImportRowErrorEntity } from '../entities/client-import-row-error.entity';
import { PlanEntity } from '../../plans/entities/plan.entity';
import { SectorEntity } from '../../geography/entities/sector.entity';
import { MunicipalityEntity } from '../../geography/entities/municipality.entity';
import { MinioStorageService } from '../../storage/minio-storage.service';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';

const LEGACY_HEADER =
  'Nombre,DNI/C.I./C.C./IFE,Telefono,Direccion,Barrio/Localidad,Ciudad/Municipio,Coordenadas,Estado,Plan Internet,Fecha Instalacion,Saldo';

function csvRow(overrides: Partial<Record<string, string>> = {}): string {
  const defaults = {
    nombre: 'Moises Perez',
    dni: '010-00000000-0',
    telefono: '8297477753',
    direccion: 'Calle 1ra #14',
    barrio: 'Las Yayas',
    ciudad: 'Azua',
    coords: '',
    estado: 'Activo',
    plan: '50.0 Mbps 1600.00',
    fecha: '20/01/2024',
    saldo: '200.00',
    ...overrides,
  };
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [
    defaults.nombre,
    defaults.dni,
    defaults.telefono,
    defaults.direccion,
    defaults.barrio,
    defaults.ciudad,
    defaults.coords,
    defaults.estado,
    defaults.plan,
    defaults.fecha,
    defaults.saldo,
  ]
    .map(quote)
    .join(',');
}

function makeFile(content: string, name = 'clientes.csv'): Express.Multer.File {
  return { buffer: Buffer.from(content, 'utf8'), originalname: name, mimetype: 'text/csv' } as Express.Multer.File;
}

describe('ClientsImportService', () => {
  let service: ClientsImportService;
  let batchRepo: any;
  let rowErrorRepo: any;
  let planRepo: any;
  let sectorRepo: any;
  let municipalityRepo: any;
  let minioStorage: any;
  let importQueue: any;

  beforeEach(async () => {
    const batches = new Map<string, ClientImportBatchEntity>();
    batchRepo = {
      create: jest.fn((dto: any) => ({ id: dto.id || `batch-${batches.size + 1}`, ...dto })),
      save: jest.fn((entity: any) => {
        const saved = { ...entity, id: entity.id || `batch-${batches.size + 1}` };
        batches.set(saved.id, saved);
        return Promise.resolve(saved);
      }),
      findOneBy: jest.fn(({ id }: any) => Promise.resolve(batches.get(id) || null)),
    };
    rowErrorRepo = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    planRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    sectorRepo = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'sector-1', name: 'Las Yayas' }),
      find: jest.fn().mockResolvedValue([]),
    };
    municipalityRepo = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'muni-1', name: 'Azua' }),
      find: jest.fn().mockResolvedValue([]),
    };
    minioStorage = {
      uploadBuffer: jest.fn().mockResolvedValue('client-imports/clientes.csv'),
      getObjectBuffer: jest.fn(),
    };
    importQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsImportService,
        { provide: getRepositoryToken(ClientImportBatchEntity), useValue: batchRepo },
        { provide: getRepositoryToken(ClientImportRowErrorEntity), useValue: rowErrorRepo },
        { provide: getRepositoryToken(PlanEntity), useValue: planRepo },
        { provide: getRepositoryToken(SectorEntity), useValue: sectorRepo },
        { provide: getRepositoryToken(MunicipalityEntity), useValue: municipalityRepo },
        { provide: MinioStorageService, useValue: minioStorage },
        { provide: getQueueToken(CLIENTS_IMPORT_QUEUE), useValue: importQueue },
        { provide: TenantContextService, useValue: { getSlug: jest.fn().mockReturnValue('tenant-test') } },
      ],
    }).compile();

    service = module.get<ClientsImportService>(ClientsImportService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('analyze', () => {
    it('sin archivo -> BadRequestException', async () => {
      await expect(service.analyze(undefined, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('archivo sin filas de datos -> BadRequestException', async () => {
      await expect(service.analyze(makeFile(LEGACY_HEADER), 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('sube el archivo a MinIO y crea el batch con status ANALYZED cuando hay ubicaciones por mapear', async () => {
      const content = `${LEGACY_HEADER}\n${csvRow()}`;
      const result = await service.analyze(makeFile(content), 'user-1');

      expect(minioStorage.uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'clientes.csv', 'client-imports', 'text/csv');
      expect(result.totalRows).toBe(1);
      expect(result.distinctLocations).toHaveLength(1);
      expect(result.distinctLocations[0]).toMatchObject({ barrio: 'Las Yayas', ciudadMunicipio: 'Azua', occurrences: 1 });

      const batch = await batchRepo.findOneBy({ id: result.batchId });
      expect(batch.status).toBe('ANALYZED');
    });

    it('cuando ninguna fila tiene barrio/ciudad, el batch queda MAPPED de una vez (nada que resolver)', async () => {
      const content = `${LEGACY_HEADER}\n${csvRow({ barrio: '', ciudad: '' })}`;
      const result = await service.analyze(makeFile(content), 'user-1');
      expect(result.distinctLocations).toHaveLength(0);

      const batch = await batchRepo.findOneBy({ id: result.batchId });
      expect(batch.status).toBe('MAPPED');
    });

    it('resume los planes distintos con velocidad/precio parseados', async () => {
      const content = `${LEGACY_HEADER}\n${csvRow({ plan: '50.0 Mbps 1600.00' })}\n${csvRow({ nombre: 'Cliente 2', dni: '020-1111111-1', plan: '50.0 Mbps 1600.00' })}`;
      const result = await service.analyze(makeFile(content), 'user-1');

      expect(result.distinctPlans).toHaveLength(1);
      expect(result.distinctPlans[0]).toMatchObject({
        raw: '50.0 Mbps 1600.00',
        speedMbps: 50,
        monthlyPrice: 1600,
        parseable: true,
        occurrences: 2,
        matchesExistingPlan: false,
      });
    });

    it('marca matchesExistingPlan=true si ya existe un Plan con esa velocidad y precio', async () => {
      planRepo.findOne.mockResolvedValue({ id: 'plan-1', speedMbps: 50, monthlyPrice: 1600 });
      const content = `${LEGACY_HEADER}\n${csvRow()}`;
      const result = await service.analyze(makeFile(content), 'user-1');
      expect(result.distinctPlans[0].matchesExistingPlan).toBe(true);
    });

    it('un plan sin velocidad explícita ("PYME Basico 2800.00") se resuelve por nombre+precio, no queda "Sin contrato"', async () => {
      planRepo.find = jest.fn().mockResolvedValue([{ id: 'plan-1', name: 'PYME Básico 50 Mbps', speedMbps: 50, monthlyPrice: 2800 }]);
      const content = `${LEGACY_HEADER}\n${csvRow({ plan: 'PYME Basico 2800.00' })}`;
      const result = await service.analyze(makeFile(content), 'user-1');

      expect(result.distinctPlans[0]).toMatchObject({
        raw: 'PYME Basico 2800.00',
        speedMbps: 50,
        monthlyPrice: 2800,
        parseable: true,
        matchesExistingPlan: true,
      });
    });

    it('un plan sin velocidad y sin match en el catálogo queda parseable=false (no se inventa una velocidad)', async () => {
      planRepo.find = jest.fn().mockResolvedValue([]);
      const content = `${LEGACY_HEADER}\n${csvRow({ plan: 'Plan Corporativo Especial 3000.00' })}`;
      const result = await service.analyze(makeFile(content), 'user-1');

      expect(result.distinctPlans[0]).toMatchObject({ parseable: false, matchesExistingPlan: false });
    });

    it('cuenta filas sin nombre o sin documento como rowsMissingRequiredFields', async () => {
      const content = `${LEGACY_HEADER}\n${csvRow({ nombre: '' })}\n${csvRow({ dni: '', nombre: 'Cliente 2' })}`;
      const result = await service.analyze(makeFile(content), 'user-1');
      expect(result.rowsMissingRequiredFields).toBe(2);
    });

    it('auto-resuelve el municipio por nombre (sin tildes/mayúsculas) y crea el sector nuevo al confirmar si no existe', async () => {
      municipalityRepo.find.mockResolvedValue([{ id: 'muni-1', name: 'Azúa', province: { name: 'Azua' } }]);
      sectorRepo.find.mockResolvedValue([]); // el barrio "Las Yayas" no existe todavía como sector

      const content = `${LEGACY_HEADER}\n${csvRow({ barrio: 'Las Yayas', ciudad: 'azua' })}`; // minúscula, sin tilde
      const result = await service.analyze(makeFile(content), 'user-1');

      expect(result.distinctLocations).toHaveLength(1);
      expect(result.distinctLocations[0]).toMatchObject({
        resolved: true,
        autoMatch: { provinceName: 'Azua', municipalityName: 'Azúa', sectorName: 'Las Yayas', sectorIsNew: true },
      });

      const batch = await batchRepo.findOneBy({ id: result.batchId });
      expect(batch.status).toBe('MAPPED'); // ya no requiere pasar por el paso manual de mapeo
      expect(batch.locationMapping['LAS YAYAS||AZUA']).toEqual({
        createNew: { name: 'Las Yayas', municipalityId: 'muni-1' },
      });
    });

    it('auto-resuelve al sector existente (por nombre) en vez de crear uno duplicado', async () => {
      municipalityRepo.find.mockResolvedValue([{ id: 'muni-1', name: 'Azua', province: { name: 'Azua' } }]);
      sectorRepo.find.mockResolvedValue([{ id: 'sector-9', name: 'Las Yayas', municipalityId: 'muni-1' }]);

      const content = `${LEGACY_HEADER}\n${csvRow({ barrio: 'las yayas', ciudad: 'Azua' })}`;
      const result = await service.analyze(makeFile(content), 'user-1');

      expect(result.distinctLocations[0]).toMatchObject({
        resolved: true,
        autoMatch: { sectorName: 'Las Yayas', sectorIsNew: false },
      });

      const batch = await batchRepo.findOneBy({ id: result.batchId });
      expect(batch.locationMapping['LAS YAYAS||AZUA']).toEqual({ sectorId: 'sector-9' });
    });

    it('auto-resuelve "Azua" contra el municipio oficial "Azua de Compostela" (nombre corto vs. largo, caso real de RD)', async () => {
      municipalityRepo.find.mockResolvedValue([{ id: 'muni-azua', name: 'Azua de Compostela', province: { name: 'Azua' } }]);
      sectorRepo.find.mockResolvedValue([{ id: 'sector-guanabanas', name: 'Las Guanábanas', municipalityId: 'muni-azua' }]);

      const content = `${LEGACY_HEADER}\n${csvRow({ barrio: 'Las Guanabanas', ciudad: 'Azua' })}`;
      const result = await service.analyze(makeFile(content), 'user-1');

      expect(result.distinctLocations[0]).toMatchObject({
        resolved: true,
        autoMatch: { municipalityName: 'Azua de Compostela', sectorName: 'Las Guanábanas', sectorIsNew: false },
      });
      const batch = await batchRepo.findOneBy({ id: result.batchId });
      expect(batch.locationMapping['LAS GUANABANAS||AZUA']).toEqual({ sectorId: 'sector-guanabanas' });
    });

    it('municipio ambiguo (mismo nombre en más de una provincia) no se auto-resuelve, queda para revisión manual', async () => {
      municipalityRepo.find.mockResolvedValue([
        { id: 'muni-1', name: 'Villa González', province: { name: 'Santiago' } },
        { id: 'muni-2', name: 'Villa González', province: { name: 'Otra Provincia' } },
      ]);

      const content = `${LEGACY_HEADER}\n${csvRow({ barrio: 'Centro', ciudad: 'Villa González' })}`;
      const result = await service.analyze(makeFile(content), 'user-1');

      expect(result.distinctLocations[0].resolved).toBe(false);
      const batch = await batchRepo.findOneBy({ id: result.batchId });
      expect(batch.status).toBe('ANALYZED');
    });
  });

  describe('submitLocationMapping', () => {
    async function analyzedBatch() {
      const content = `${LEGACY_HEADER}\n${csvRow()}`;
      minioStorage.getObjectBuffer.mockResolvedValue(Buffer.from(content, 'utf8'));
      const result = await service.analyze(makeFile(content), 'user-1');
      return result.batchId;
    }

    it('batch inexistente -> NotFoundException', async () => {
      await expect(
        service.submitLocationMapping('no-existe', { mappings: [] } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('entrada sin sectorId ni createNew -> BadRequestException', async () => {
      const batchId = await analyzedBatch();
      await expect(
        service.submitLocationMapping(batchId, { mappings: [{ legacyLocationKey: 'LAS YAYAS||AZUA' }] } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('sectorId que no existe -> BadRequestException', async () => {
      sectorRepo.findOneBy.mockResolvedValue(null);
      const batchId = await analyzedBatch();
      await expect(
        service.submitLocationMapping(batchId, {
          mappings: [{ legacyLocationKey: 'LAS YAYAS||AZUA', sectorId: 'sector-inexistente' }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('createNew con municipalityId que no existe -> BadRequestException', async () => {
      municipalityRepo.findOneBy.mockResolvedValue(null);
      const batchId = await analyzedBatch();
      await expect(
        service.submitLocationMapping(batchId, {
          mappings: [{ legacyLocationKey: 'LAS YAYAS||AZUA', createNew: { name: 'Las Yayas', municipalityId: 'muni-x' } }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('con todas las ubicaciones resueltas, pasa a status MAPPED y resolved=true', async () => {
      const batchId = await analyzedBatch();
      const result = await service.submitLocationMapping(batchId, {
        mappings: [{ legacyLocationKey: 'LAS YAYAS||AZUA', sectorId: 'sector-1' }],
      } as any);

      expect(result).toEqual({ resolved: true, missingKeys: [] });
      const batch = await batchRepo.findOneBy({ id: batchId });
      expect(batch.status).toBe('MAPPED');
      expect(batch.locationMapping['LAS YAYAS||AZUA']).toEqual({ sectorId: 'sector-1' });
    });

    it('batch en estado QUEUED ya no admite editar el mapeo', async () => {
      const batchId = await analyzedBatch();
      await service.submitLocationMapping(batchId, {
        mappings: [{ legacyLocationKey: 'LAS YAYAS||AZUA', sectorId: 'sector-1' }],
      } as any);
      await service.confirm(batchId);

      await expect(
        service.submitLocationMapping(batchId, { mappings: [] } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('confirm', () => {
    it('batch no encontrado -> NotFoundException', async () => {
      await expect(service.confirm('no-existe')).rejects.toThrow(NotFoundException);
    });

    it('batch que no está MAPPED -> BadRequestException', async () => {
      const content = `${LEGACY_HEADER}\n${csvRow()}`;
      const result = await service.analyze(makeFile(content), 'user-1'); // queda en ANALYZED (hay ubicación sin mapear)
      await expect(service.confirm(result.batchId)).rejects.toThrow(BadRequestException);
    });

    it('batch MAPPED -> pasa a QUEUED y encola el job', async () => {
      const content = `${LEGACY_HEADER}\n${csvRow({ barrio: '', ciudad: '' })}`; // sin ubicación que mapear -> MAPPED directo
      const result = await service.analyze(makeFile(content), 'user-1');

      await service.confirm(result.batchId);

      const batch = await batchRepo.findOneBy({ id: result.batchId });
      expect(batch.status).toBe('QUEUED');
      expect(importQueue.add).toHaveBeenCalledWith(
        'process-batch',
        { batchId: result.batchId, tenantSlug: 'tenant-test' },
        expect.objectContaining({ removeOnComplete: true }),
      );
    });
  });

  describe('getStatus / getErrors / listBatches', () => {
    it('getStatus de un batch inexistente -> NotFoundException', async () => {
      await expect(service.getStatus('no-existe')).rejects.toThrow(NotFoundException);
    });

    it('getErrors valida que el batch exista antes de paginar', async () => {
      await expect(service.getErrors('no-existe', {})).rejects.toThrow(NotFoundException);
    });

    it('listBatches delega en findAndCount con paginación', async () => {
      batchRepo.findAndCount = jest.fn().mockResolvedValue([[{ id: 'batch-1' }], 1]);
      const result = await service.listBatches({ page: 1, limit: 15 } as any);
      expect(result).toEqual({ data: [{ id: 'batch-1' }], total: 1, page: 1, limit: 15, totalPages: 1 });
    });
  });

  describe('getCredentialsReport', () => {
    it('batch inexistente -> NotFoundException', async () => {
      await expect(service.getCredentialsReport('no-existe')).rejects.toThrow(NotFoundException);
    });

    it('batch sin reporte de credenciales (no terminó, o no creó clientes nuevos) -> NotFoundException', async () => {
      const content = `${LEGACY_HEADER}\n${csvRow({ barrio: '', ciudad: '' })}`;
      const result = await service.analyze(makeFile(content), 'user-1');

      await expect(service.getCredentialsReport(result.batchId)).rejects.toThrow(NotFoundException);
    });

    it('con reporte disponible, descarga el buffer desde MinIO', async () => {
      const content = `${LEGACY_HEADER}\n${csvRow({ barrio: '', ciudad: '' })}`;
      const result = await service.analyze(makeFile(content), 'user-1');

      const batch = await batchRepo.findOneBy({ id: result.batchId });
      batch.credentialsReportObjectKey = 'client-import-credentials/credenciales_batch-x.csv';
      await batchRepo.save(batch);

      minioStorage.getObjectBuffer.mockResolvedValue(Buffer.from('contenido-csv'));
      const report = await service.getCredentialsReport(result.batchId);

      expect(minioStorage.getObjectBuffer).toHaveBeenCalledWith('client-import-credentials/credenciales_batch-x.csv');
      expect(report.buffer.toString('utf8')).toBe('contenido-csv');
      expect(report.filename).toBe(`credenciales_${result.batchId}.csv`);
    });
  });
});
