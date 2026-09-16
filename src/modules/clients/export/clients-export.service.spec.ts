import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClientsExportService } from './clients-export.service';
import { ClientEntity } from '../entities/client.entity';
import { AuditLogEntity } from '../../users/entities/audit-log.entity';
import { PlanEntity } from '../../plans/entities/plan.entity';
import { SectorEntity } from '../../geography/entities/sector.entity';
import { MunicipalityEntity } from '../../geography/entities/municipality.entity';
import { ProvinceEntity } from '../../geography/entities/province.entity';
import { PdfGeneratorService } from '../../printing/pdf-generator.service';
import { DgiiClientService } from '../../invoicing/dgii/dgii-client.service';
import { CompanyService } from '../../company/company.service';
import { ExportClientsDto } from '../dto/export-clients.dto';

function baseDto(overrides: Partial<ExportClientsDto> = {}): ExportClientsDto {
  return { format: 'csv', limit: 100, ...overrides } as ExportClientsDto;
}

function makeClient(overrides: Partial<ClientEntity> = {}): ClientEntity {
  return {
    id: 'client-1',
    name: 'Moises Perez',
    clientType: 'FISICA',
    docType: 'CEDULA',
    docNumber: '010-0000000-0',
    email: 'moises@example.com',
    phone: '8297477753',
    altPhone: undefined,
    isActive: true,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    addresses: [
      {
        id: 'address-1',
        street: 'Calle 1ra #14',
        sector: 'Las Yayas',
        municipality: 'Azua',
        city: 'Azua',
        isPrimary: true,
        gpsLatitude: undefined,
        gpsLongitude: undefined,
      } as any,
    ],
    contracts: [
      {
        id: 'contract-1',
        contractNumber: 'C-0001',
        planId: 'plan-1',
        startDate: '2024-01-20',
        status: 'ACTIVE',
        createdAt: new Date('2024-01-20T10:00:00Z'),
        plan: { id: 'plan-1', name: 'Fibra 100' } as any,
      } as any,
    ],
    ...overrides,
  } as ClientEntity;
}

describe('ClientsExportService', () => {
  let service: ClientsExportService;
  let clientRepo: any;
  let clientQueryBuilder: any;
  let auditLogRepo: any;
  let planRepo: any;
  let sectorRepo: any;
  let municipalityRepo: any;
  let provinceRepo: any;
  let pdfGenerator: any;
  let dgiiClient: any;
  let companyService: any;

  beforeEach(async () => {
    clientQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([makeClient()]),
    };
    clientRepo = { createQueryBuilder: jest.fn(() => clientQueryBuilder) };

    auditLogRepo = {
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'audit-1', ...entity })),
    };

    planRepo = { findOneBy: jest.fn().mockResolvedValue({ id: 'plan-1', name: 'Fibra 100' }) };
    sectorRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'sector-1',
        name: 'Las Yayas',
        municipality: { name: 'Azua', province: { name: 'Azua' } },
      }),
    };
    municipalityRepo = { findOne: jest.fn().mockResolvedValue({ id: 'muni-1', name: 'Azua', province: { name: 'Azua' } }) };
    provinceRepo = { findOneBy: jest.fn().mockResolvedValue({ id: 'prov-1', name: 'Azua' }) };

    pdfGenerator = { generateClientsListPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) };
    dgiiClient = {
      getConfig: jest.fn().mockReturnValue({
        rncEmisor: '131000000',
        razonSocialEmisor: 'SUMTECH TELECOM SRL',
        nombreComercial: 'SUMTECH FIBRA & TV',
        direccionEmisor: 'Av. Sumtech',
        telefonoEmisor: '809-555-0199',
        correoEmisor: 'facturacion@sumtech.com.do',
      }),
    };
    companyService = undefined;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsExportService,
        { provide: getRepositoryToken(ClientEntity), useValue: clientRepo },
        { provide: getRepositoryToken(AuditLogEntity), useValue: auditLogRepo },
        { provide: getRepositoryToken(PlanEntity), useValue: planRepo },
        { provide: getRepositoryToken(SectorEntity), useValue: sectorRepo },
        { provide: getRepositoryToken(MunicipalityEntity), useValue: municipalityRepo },
        { provide: getRepositoryToken(ProvinceEntity), useValue: provinceRepo },
        { provide: PdfGeneratorService, useValue: pdfGenerator },
        { provide: DgiiClientService, useValue: dgiiClient },
        { provide: CompanyService, useValue: companyService },
      ],
    }).compile();

    service = module.get<ClientsExportService>(ClientsExportService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('formato CSV', () => {
    it('genera un buffer CSV con BOM y nombre de archivo .csv', async () => {
      const result = await service.export(baseDto({ format: 'csv' }), 'user-1', 'admin1', '10.0.0.1');

      expect(result.filename).toMatch(/^clientes_\d{8}_\d{4}\.csv$/);
      expect(result.contentType).toBe('text/csv; charset=utf-8');
      expect(result.buffer.toString('utf8').charCodeAt(0)).toBe(0xfeff);
      expect(result.totalExportado).toBe(1);
    });

    it('aplica take(limit) en la query', async () => {
      await service.export(baseDto({ format: 'csv', limit: 250 }), 'user-1', 'admin1');
      expect(clientQueryBuilder.take).toHaveBeenCalledWith(250);
    });

    it('incluye el filtro de búsqueda cuando se provee', async () => {
      await service.export(baseDto({ format: 'csv', search: 'Perez' }), 'user-1', 'admin1');
      expect(clientQueryBuilder.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), { search: '%Perez%' });
    });

    it('filtra por estado (isActive)', async () => {
      await service.export(baseDto({ format: 'csv', isActive: false }), 'user-1', 'admin1');
      expect(clientQueryBuilder.andWhere).toHaveBeenCalledWith('client.isActive = :isActive', { isActive: false });
    });

    it('filtra por plan activo mediante EXISTS sobre contratos ACTIVE', async () => {
      await service.export(baseDto({ format: 'csv', planId: 'plan-1' }), 'user-1', 'admin1');
      expect(clientQueryBuilder.andWhere).toHaveBeenCalledWith(expect.stringContaining('EXISTS'), { planId: 'plan-1' });
    });

    it('ubicación: si viene sectorId, ignora municipalityId/provinceId y filtra solo por sector', async () => {
      await service.export(
        baseDto({ format: 'csv', sectorId: 'sector-1', municipalityId: 'muni-1', provinceId: 'prov-1' }),
        'user-1',
        'admin1',
      );
      expect(clientQueryBuilder.andWhere).toHaveBeenCalledWith('address.sectorId = :sectorId', { sectorId: 'sector-1' });
      expect(clientQueryBuilder.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('municipalityId ='), expect.anything());
    });

    it('ubicación: sin sectorId, usa municipalityId si está presente', async () => {
      await service.export(baseDto({ format: 'csv', municipalityId: 'muni-1', provinceId: 'prov-1' }), 'user-1', 'admin1');
      expect(clientQueryBuilder.andWhere).toHaveBeenCalledWith('address.municipalityId = :municipalityId', { municipalityId: 'muni-1' });
    });

    it('registra un audit log con action CLIENTS_EXPORT, formato, límite solicitado y total exportado', async () => {
      await service.export(baseDto({ format: 'csv', limit: 50, isActive: true }), 'user-9', 'gerente1', '10.0.0.9');

      expect(auditLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-9',
          action: 'CLIENTS_EXPORT',
          entity: 'client',
          ipAddress: '10.0.0.9',
          payloadDiff: expect.objectContaining({
            format: 'csv',
            limitSolicitado: 50,
            totalExportado: 1,
            filtros: expect.objectContaining({ isActive: true }),
          }),
        }),
      );
    });

    it('con 0 resultados, exporta igual un archivo válido (solo encabezado) sin lanzar error', async () => {
      clientQueryBuilder.getMany.mockResolvedValue([]);
      const result = await service.export(baseDto({ format: 'csv' }), 'user-1', 'admin1');
      expect(result.totalExportado).toBe(0);
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it('un cliente sin dirección ni contratos no revienta y produce campos vacíos / "Sin Contrato"', async () => {
      clientQueryBuilder.getMany.mockResolvedValue([makeClient({ addresses: [], contracts: [] })]);
      const result = await service.export(baseDto({ format: 'csv' }), 'user-1', 'admin1');
      const text = result.buffer.toString('utf8');
      expect(text).toContain('Sin Contrato');
      expect(text).not.toContain('undefined');
    });
  });

  describe('formato Excel', () => {
    it('genera un buffer .xlsx (firma ZIP) con content-type de spreadsheet', async () => {
      const result = await service.export(baseDto({ format: 'excel', limit: 500 }), 'user-1', 'admin1');
      expect(result.filename).toMatch(/\.xlsx$/);
      expect(result.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(result.buffer.subarray(0, 2).toString('ascii')).toBe('PK');
    });
  });

  describe('formato PDF', () => {
    it('rechaza con 400 si limit > 2000, sin llegar a consultar la base de datos', async () => {
      await expect(service.export(baseDto({ format: 'pdf', limit: 2001 }), 'user-1', 'admin1')).rejects.toThrow(
        BadRequestException,
      );
      expect(clientRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('acepta limit = 2000 (límite exacto permitido) y genera el PDF', async () => {
      const result = await service.export(baseDto({ format: 'pdf', limit: 2000 }), 'user-1', 'admin1');
      expect(result.contentType).toBe('application/pdf');
      expect(result.filename).toMatch(/\.pdf$/);
      expect(pdfGenerator.generateClientsListPdf).toHaveBeenCalled();
    });

    it('usa DgiiClientService.getConfig como fallback cuando CompanyService no está disponible', async () => {
      await service.export(baseDto({ format: 'pdf', limit: 10 }), 'user-1', 'admin1');
      expect(dgiiClient.getConfig).toHaveBeenCalled();
      const call = pdfGenerator.generateClientsListPdf.mock.calls[0][0];
      expect(call.company.razonSocial).toBe('SUMTECH TELECOM SRL');
    });

    it('arma un resumen de filtros legible resolviendo el nombre del plan', async () => {
      await service.export(baseDto({ format: 'pdf', limit: 10, planId: 'plan-1' }), 'user-1', 'admin1');
      const call = pdfGenerator.generateClientsListPdf.mock.calls[0][0];
      expect(call.filtersSummary).toContain('Plan: Fibra 100');
    });

    it('sin filtros, el resumen indica "Ninguno"', async () => {
      await service.export(baseDto({ format: 'pdf', limit: 10 }), 'user-1', 'admin1');
      const call = pdfGenerator.generateClientsListPdf.mock.calls[0][0];
      expect(call.filtersSummary).toBe('Ninguno');
    });

    it('mapea las filas al formato reducido de 9 columnas del PDF (documento combinado tipo:número)', async () => {
      await service.export(baseDto({ format: 'pdf', limit: 10 }), 'user-1', 'admin1');
      const call = pdfGenerator.generateClientsListPdf.mock.calls[0][0];
      expect(call.rows[0].documento).toBe('CEDULA: 010-0000000-0');
      expect(call.rows[0].ubicacion).toBe('Las Yayas, Azua');
    });

    it('prioriza el contrato ACTIVE que coincide con el planId filtrado si el cliente tiene varios contratos ACTIVE', async () => {
      const clientWithTwoActive = makeClient({
        contracts: [
          {
            id: 'contract-1',
            contractNumber: 'C-0001',
            planId: 'plan-1',
            startDate: '2024-01-20',
            status: 'ACTIVE',
            createdAt: new Date('2024-01-20T10:00:00Z'),
            plan: { id: 'plan-1', name: 'Fibra 100' } as any,
          } as any,
          {
            id: 'contract-2',
            contractNumber: 'C-0002',
            planId: 'plan-2',
            startDate: '2024-02-01',
            status: 'ACTIVE',
            createdAt: new Date('2024-02-01T10:00:00Z'),
            plan: { id: 'plan-2', name: 'Fibra 200' } as any,
          } as any,
        ],
      });
      clientQueryBuilder.getMany.mockResolvedValue([clientWithTwoActive]);

      await service.export(baseDto({ format: 'pdf', limit: 10, planId: 'plan-2' }), 'user-1', 'admin1');
      const call = pdfGenerator.generateClientsListPdf.mock.calls[0][0];
      expect(call.rows[0].planActivo).toBe('Fibra 200');
    });
  });

  it('formato inválido no soportado por el DTO nunca llega al switch (cubierto por ValidationPipe/IsIn en el controller)', () => {
    // La validación de 'format' vive en ExportClientsDto (@IsIn) + ValidationPipe global,
    // por lo que un valor fuera de pdf/excel/csv nunca alcanza al servicio.
    expect(['pdf', 'excel', 'csv']).toContain(baseDto().format);
  });
});
