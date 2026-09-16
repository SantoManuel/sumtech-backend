import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClientsImportProcessor } from './clients-import.processor';
import { ClientImportBatchEntity } from '../entities/client-import-batch.entity';
import { ClientImportRowErrorEntity } from '../entities/client-import-row-error.entity';
import { ClientEntity } from '../entities/client.entity';
import { AddressEntity } from '../entities/address.entity';
import { ContractEntity } from '../entities/contract.entity';
import { PlanEntity } from '../../plans/entities/plan.entity';
import { SectorEntity } from '../../geography/entities/sector.entity';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { RoleEntity } from '../../users/entities/role.entity';
import { MinioStorageService } from '../../storage/minio-storage.service';

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

/** Fábrica de un repo en memoria mínimo (find/findOne por predicado, create/save). */
function makeInMemoryRepo(idPrefix: string) {
  const rows: any[] = [];
  let counter = 0;
  return {
    rows,
    create: jest.fn((dto: any) => ({ ...dto })),
    save: jest.fn((entity: any) => {
      if (!entity.id) {
        entity.id = `${idPrefix}-${++counter}`;
        rows.push(entity);
      } else {
        const idx = rows.findIndex((r: any) => r.id === entity.id);
        if (idx >= 0) rows[idx] = entity;
        else rows.push(entity);
      }
      return Promise.resolve(entity);
    }),
    find: jest.fn(() => Promise.resolve([...rows])),
    findOne: jest.fn((options: any) => {
      const where = options?.where || {};
      // TypeORM: un array de condiciones es OR entre ellas; un objeto plano es AND entre sus campos.
      const whereClauses = Array.isArray(where) ? where : [where];
      const match = rows.find((r: any) =>
        whereClauses.some((clause) => Object.entries(clause).every(([k, v]) => (r as any)[k] === v)),
      );
      return Promise.resolve(match || null);
    }),
    findOneBy: jest.fn((where: any) => {
      const match = rows.find((r: any) => Object.entries(where).every(([k, v]) => (r as any)[k] === v));
      return Promise.resolve(match || null);
    }),
  };
}

describe('ClientsImportProcessor', () => {
  let processor: ClientsImportProcessor;
  let batchRepo: any;
  let rowErrorRepo: ReturnType<typeof makeInMemoryRepo>;
  let clientRepo: ReturnType<typeof makeInMemoryRepo>;
  let addressRepo: ReturnType<typeof makeInMemoryRepo>;
  let contractRepo: ReturnType<typeof makeInMemoryRepo>;
  let planRepo: ReturnType<typeof makeInMemoryRepo>;
  let sectorRepo: ReturnType<typeof makeInMemoryRepo>;
  let invoiceRepo: ReturnType<typeof makeInMemoryRepo>;
  let userRepo: ReturnType<typeof makeInMemoryRepo>;
  let roleRepo: ReturnType<typeof makeInMemoryRepo>;
  let minioStorage: any;
  let batch: ClientImportBatchEntity;

  function makeJob(fileContent: string) {
    minioStorage.getObjectBuffer.mockResolvedValue(Buffer.from(fileContent, 'utf8'));
    return { data: { batchId: batch.id }, updateProgress: jest.fn() } as any;
  }

  beforeEach(async () => {
    batch = {
      id: 'batch-1',
      status: 'QUEUED',
      format: 'csv',
      originalFilename: 'clientes.csv',
      minioObjectKey: 'client-imports/clientes.csv',
      totalRows: 0,
      processedRows: 0,
      createdCount: 0,
      updatedCount: 0,
      errorCount: 0,
      locationMapping: { 'LAS YAYAS||AZUA': { sectorId: 'sector-1' } },
      createdAt: new Date(),
    } as ClientImportBatchEntity;

    batchRepo = {
      findOneBy: jest.fn(() => Promise.resolve(batch)),
      save: jest.fn((entity: any) => {
        batch = { ...batch, ...entity };
        return Promise.resolve(batch);
      }),
    };
    rowErrorRepo = makeInMemoryRepo('row-error');
    clientRepo = makeInMemoryRepo('client');
    addressRepo = makeInMemoryRepo('address');
    contractRepo = makeInMemoryRepo('contract');
    planRepo = makeInMemoryRepo('plan');
    sectorRepo = makeInMemoryRepo('sector');
    sectorRepo.rows.push({ id: 'sector-1', name: 'Las Yayas', municipalityId: 'muni-1', municipality: { id: 'muni-1', provinceId: 'prov-1' } } as any);
    invoiceRepo = makeInMemoryRepo('invoice');
    userRepo = makeInMemoryRepo('user');
    roleRepo = makeInMemoryRepo('role');
    minioStorage = {
      getObjectBuffer: jest.fn(),
      uploadBuffer: jest.fn().mockResolvedValue('client-import-credentials/credenciales_batch-1.csv'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsImportProcessor,
        { provide: getRepositoryToken(ClientImportBatchEntity), useValue: batchRepo },
        { provide: getRepositoryToken(ClientImportRowErrorEntity), useValue: rowErrorRepo },
        { provide: getRepositoryToken(ClientEntity), useValue: clientRepo },
        { provide: getRepositoryToken(AddressEntity), useValue: addressRepo },
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: getRepositoryToken(PlanEntity), useValue: planRepo },
        { provide: getRepositoryToken(SectorEntity), useValue: sectorRepo },
        { provide: getRepositoryToken(InvoiceEntity), useValue: invoiceRepo },
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: getRepositoryToken(RoleEntity), useValue: roleRepo },
        { provide: MinioStorageService, useValue: minioStorage },
      ],
    }).compile();

    processor = module.get<ClientsImportProcessor>(ClientsImportProcessor);
  });

  it('debe estar definido', () => {
    expect(processor).toBeDefined();
  });

  it('procesa un cliente nuevo: crea cliente, dirección con sector resuelto, plan, contrato y factura de saldo inicial', async () => {
    const content = `${LEGACY_HEADER}\n${csvRow()}`;
    await processor.process(makeJob(content));

    expect(clientRepo.rows).toHaveLength(1);
    expect(clientRepo.rows[0]).toMatchObject({ name: 'Moises Perez', docNumber: '010-00000000-0' });
    expect(clientRepo.rows[0].userId).toBeDefined();

    expect(userRepo.rows).toHaveLength(1);
    expect(userRepo.rows[0]).toMatchObject({ username: '010000000000', email: '010000000000@clientes.sumtech.local' });
    expect(roleRepo.rows.some((r: any) => r.name === 'CLIENTE')).toBe(true);

    expect(addressRepo.rows).toHaveLength(1);
    expect(addressRepo.rows[0]).toMatchObject({ sectorId: 'sector-1', municipalityId: 'muni-1', provinceId: 'prov-1' });

    expect(planRepo.rows).toHaveLength(1);
    expect(planRepo.rows[0]).toMatchObject({ speedMbps: 50, monthlyPrice: 1600, name: 'Plan Importado 50 Mbps' });

    expect(contractRepo.rows).toHaveLength(1);
    expect(contractRepo.rows[0]).toMatchObject({ status: 'ACTIVE', startDate: '2024-01-20' });

    expect(invoiceRepo.rows).toHaveLength(1);
    expect(invoiceRepo.rows[0]).toMatchObject({
      status: 'PENDING_PAYMENT',
      grandTotal: 200,
      concept: 'Saldo Inicial (Migración Sistema Anterior)',
    });

    expect(batch.status).toBe('DONE');
    expect(batch.createdCount).toBe(1);
    expect(batch.processedRows).toBe(1);
  });

  it('un cliente ya existente (mismo docNumber normalizado) se actualiza, no se duplica', async () => {
    clientRepo.rows.push({
      id: 'existing-client',
      docNumber: '010000000000', // formato distinto (sin guiones), misma normalización que "010-00000000-0"
      name: 'Nombre Viejo',
      phone: '000',
      clientType: 'FISICA',
      docType: 'CEDULA',
      email: '',
      isActive: true,
    } as any);

    const content = `${LEGACY_HEADER}\n${csvRow({ nombre: 'Moises Perez Actualizado' })}`;
    await processor.process(makeJob(content));

    expect(clientRepo.rows).toHaveLength(1);
    expect(clientRepo.rows[0].name).toBe('Moises Perez Actualizado');
    expect(batch.createdCount).toBe(0);
    expect(batch.updatedCount).toBe(1);
  });

  it('una fila sin nombre o sin documento se reporta como error y no interrumpe el resto del batch', async () => {
    const content = [
      LEGACY_HEADER,
      csvRow({ nombre: '' }),
      csvRow({ dni: '020-1111111-1', nombre: 'Cliente Válido' }),
    ].join('\n');

    await processor.process(makeJob(content));

    expect(batch.errorCount).toBe(1);
    expect(batch.createdCount).toBe(1);
    expect(rowErrorRepo.rows).toHaveLength(1);
    expect((rowErrorRepo.rows[0] as any).errorMessage).toContain('nombre');
  });

  it('resuelve la ubicación con createNew: crea el sector una sola vez aunque haya varias filas con la misma ubicación', async () => {
    batch.locationMapping = {
      'ENSANCHE OZAMA||SANTO DOMINGO': { createNew: { name: 'Ensanche Ozama', municipalityId: 'muni-2' } },
    };

    const content = [
      LEGACY_HEADER,
      csvRow({ dni: '030-1111111-1', barrio: 'Ensanche Ozama', ciudad: 'Santo Domingo' }),
      csvRow({ dni: '030-2222222-2', nombre: 'Cliente Dos', barrio: 'Ensanche Ozama', ciudad: 'Santo Domingo' }),
    ].join('\n');

    await processor.process(makeJob(content));

    const createdSectors = sectorRepo.rows.filter((s: any) => s.name === 'Ensanche Ozama');
    expect(createdSectors).toHaveLength(1);
    expect(addressRepo.rows.every((a: any) => a.sectorId === createdSectors[0].id)).toBe(true);
  });

  it('reutiliza el mismo Plan para 2 filas con el mismo "Plan Internet" (no crea 2 planes iguales)', async () => {
    const content = [
      LEGACY_HEADER,
      csvRow({ dni: '040-1111111-1' }),
      csvRow({ dni: '040-2222222-2', nombre: 'Cliente Dos' }),
    ].join('\n');

    await processor.process(makeJob(content));

    expect(planRepo.rows).toHaveLength(1);
    expect(contractRepo.rows).toHaveLength(2);
  });

  it('no duplica la factura de Saldo Inicial si el cliente ya tiene una PENDING_PAYMENT con ese concepto', async () => {
    clientRepo.rows.push({
      id: 'existing-client',
      docNumber: '010-00000000-0',
      name: 'Moises Perez',
      phone: '8297477753',
      clientType: 'FISICA',
      docType: 'CEDULA',
      email: '',
      isActive: true,
    } as any);
    invoiceRepo.rows.push({
      id: 'inv-existing',
      clientId: 'existing-client',
      status: 'PENDING_PAYMENT',
      concept: 'Saldo Inicial (Migración Sistema Anterior)',
      grandTotal: 999,
    } as any);

    const content = `${LEGACY_HEADER}\n${csvRow()}`;
    await processor.process(makeJob(content));

    expect(invoiceRepo.rows).toHaveLength(1);
  });

  it('sin saldo (0 o vacío) no genera factura', async () => {
    const content = `${LEGACY_HEADER}\n${csvRow({ saldo: '' })}`;
    await processor.process(makeJob(content));
    expect(invoiceRepo.rows).toHaveLength(0);
  });

  it('Plan Internet no parseable: crea el cliente/dirección igual, pero no crea contrato ni factura', async () => {
    const content = `${LEGACY_HEADER}\n${csvRow({ plan: 'Plan Premium Sin Formato' })}`;
    await processor.process(makeJob(content));

    expect(clientRepo.rows).toHaveLength(1);
    expect(contractRepo.rows).toHaveLength(0);
    expect(invoiceRepo.rows).toHaveLength(0);
    expect(batch.errorCount).toBe(0);
    expect(batch.createdCount).toBe(1);
  });

  it('ubicación sin mapeo resuelto (no debería pasar si se confirmó bien) se reporta como error de fila, no rompe el batch', async () => {
    batch.locationMapping = {}; // "LAS YAYAS||AZUA" ya no tiene mapeo
    const content = `${LEGACY_HEADER}\n${csvRow()}`;
    await processor.process(makeJob(content));

    expect(batch.errorCount).toBe(1);
    expect(rowErrorRepo.rows[0]).toMatchObject({ errorMessage: expect.stringContaining('no tiene mapeo resuelto') });
  });

  it('si falla la lectura del archivo desde MinIO, el batch queda FAILED con failureReason y el error se propaga (para que BullMQ pueda reintentar)', async () => {
    minioStorage.getObjectBuffer.mockRejectedValue(new Error('MinIO no disponible'));
    const job = { data: { batchId: batch.id }, updateProgress: jest.fn() } as any;

    await expect(processor.process(job)).rejects.toThrow('MinIO no disponible');
    expect(batch.status).toBe('FAILED');
    expect(batch.failureReason).toBe('MinIO no disponible');
  });

  it('batch inexistente: no revienta, simplemente descarta el job', async () => {
    batchRepo.findOneBy.mockResolvedValue(null);
    const job = { data: { batchId: 'no-existe' }, updateProgress: jest.fn() } as any;
    await expect(processor.process(job)).resolves.toBeUndefined();
  });

  it('actualiza el progreso del job durante el procesamiento', async () => {
    const content = `${LEGACY_HEADER}\n${csvRow()}`;
    const job = makeJob(content);
    await processor.process(job);
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  describe('cuenta digital del Portal de Autoservicio', () => {
    it('un cliente existente sin cuenta digital todavía (userId null) recibe una al actualizarse', async () => {
      clientRepo.rows.push({
        id: 'existing-client',
        docNumber: '010000000000',
        name: 'Nombre Viejo',
        phone: '000',
        clientType: 'FISICA',
        docType: 'CEDULA',
        email: '',
        isActive: true,
        userId: undefined,
      } as any);

      const content = `${LEGACY_HEADER}\n${csvRow()}`;
      await processor.process(makeJob(content));

      expect(clientRepo.rows[0].userId).toBeDefined();
      expect(userRepo.rows).toHaveLength(1);
    });

    it('un cliente que YA tiene cuenta digital no genera una segunda (ensureDigitalAccount es no-op)', async () => {
      clientRepo.rows.push({
        id: 'existing-client',
        docNumber: '010000000000',
        name: 'Nombre Viejo',
        phone: '000',
        clientType: 'FISICA',
        docType: 'CEDULA',
        email: '',
        isActive: true,
        userId: 'user-ya-existente',
      } as any);

      const content = `${LEGACY_HEADER}\n${csvRow()}`;
      await processor.process(makeJob(content));

      expect(clientRepo.rows[0].userId).toBe('user-ya-existente');
      expect(userRepo.rows).toHaveLength(0);
    });

    it('reutiliza el rol CLIENTE ya existente en vez de crear uno duplicado', async () => {
      roleRepo.rows.push({ id: 'role-cliente', name: 'CLIENTE', description: 'ya existía' } as any);

      const content = `${LEGACY_HEADER}\n${csvRow()}`;
      await processor.process(makeJob(content));

      expect(roleRepo.rows).toHaveLength(1);
      expect(userRepo.rows[0].roles).toEqual([expect.objectContaining({ id: 'role-cliente' })]);
    });

    it('dos clientes distintos en el mismo batch reciben usuarios digitales distintos', async () => {
      const content = [
        LEGACY_HEADER,
        csvRow({ dni: '050-1111111-1' }),
        csvRow({ dni: '050-2222222-2', nombre: 'Cliente Dos' }),
      ].join('\n');

      await processor.process(makeJob(content));

      expect(userRepo.rows).toHaveLength(2);
      expect(userRepo.rows[0].username).not.toBe(userRepo.rows[1].username);
    });
  });

  describe('reporte de credenciales del batch', () => {
    it('con clientes nuevos, sube un CSV a MinIO y guarda el object key en el batch', async () => {
      const content = `${LEGACY_HEADER}\n${csvRow()}`;
      await processor.process(makeJob(content));

      expect(minioStorage.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringContaining('credenciales_'),
        'client-import-credentials',
        'text/csv',
      );
      expect(batch.credentialsReportObjectKey).toBe('client-import-credentials/credenciales_batch-1.csv');

      const csvContent = (minioStorage.uploadBuffer.mock.calls[0][0] as Buffer).toString('utf8');
      expect(csvContent).toContain('Moises Perez');
      expect(csvContent).toContain('010-00000000-0');
    });

    it('sin clientes nuevos (todos ya tenían cuenta), no sube ningún reporte', async () => {
      clientRepo.rows.push({
        id: 'existing-client',
        docNumber: '010000000000',
        name: 'Nombre Viejo',
        phone: '000',
        clientType: 'FISICA',
        docType: 'CEDULA',
        email: '',
        isActive: true,
        userId: 'user-ya-existente',
      } as any);

      const content = `${LEGACY_HEADER}\n${csvRow()}`;
      await processor.process(makeJob(content));

      expect(minioStorage.uploadBuffer).not.toHaveBeenCalled();
      expect(batch.credentialsReportObjectKey).toBeUndefined();
    });

    it('con varios clientes nuevos, el reporte incluye una fila por cada uno', async () => {
      const content = [
        LEGACY_HEADER,
        csvRow({ dni: '060-1111111-1' }),
        csvRow({ dni: '060-2222222-2', nombre: 'Cliente Dos' }),
      ].join('\n');

      await processor.process(makeJob(content));

      const csvContent = (minioStorage.uploadBuffer.mock.calls[0][0] as Buffer).toString('utf8');
      const lines = csvContent.replace(/^﻿/, '').split('\r\n');
      expect(lines).toHaveLength(3); // encabezado + 2 clientes
    });
  });
});
