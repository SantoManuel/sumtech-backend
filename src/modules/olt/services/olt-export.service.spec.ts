import { OltExportService } from './olt-export.service';
import { OltEntity } from '../entities/olt.entity';

describe('OltExportService', () => {
  let service: OltExportService;
  let queryBuilder: any;
  let oltRepo: any;

  const makeOlt = (overrides: Partial<OltEntity> = {}): OltEntity =>
    ({
      id: 'olt-1',
      name: 'OLT-QUAZAR',
      vendor: 'ZTE',
      model: 'C320',
      host: '10.99.99.2',
      port: 23,
      connectionMethod: 'VIA_MIKROTIK',
      connectionStatus: 'CONECTADO',
      firmwareVersion: '2.1.0',
      lastCheckedAt: new Date('2026-10-10T20:52:00Z'),
      lastSuccessfulConnectionAt: new Date('2026-10-10T20:52:00Z'),
      isActive: true,
      viaNode: { id: 'node-1', name: 'OLTC320' } as any,
      ...overrides,
    }) as OltEntity;

  beforeEach(() => {
    queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([makeOlt()]),
    };

    oltRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder),
    };

    service = new OltExportService(oltRepo);
  });

  it('arma el CSV con BOM y encabezado esperado', async () => {
    const result = await service.export({});
    expect(result.contentType).toBe('text/csv; charset=utf-8');
    const text = result.buffer.toString('utf8').replace(/^﻿/, '');
    expect(text.split('\r\n')[0]).toContain('Fabricante');
    expect(text).toContain('OLT-QUAZAR');
    expect(text).toContain('OLTC320');
  });

  it('no filtra nada cuando el DTO viene vacío', async () => {
    await service.export({});
    expect(queryBuilder.andWhere).not.toHaveBeenCalled();
  });

  it('aplica andWhere de vendor, connectionStatus y search cuando vienen en el DTO', async () => {
    await service.export({ vendor: 'ZTE', connectionStatus: 'CONECTADO', search: 'QUAZAR' });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('olt.vendor ILIKE :vendor', { vendor: 'ZTE' });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('olt.connectionStatus = :connectionStatus', {
      connectionStatus: 'CONECTADO',
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(expect.stringContaining('olt.name ILIKE :search'), {
      search: '%QUAZAR%',
    });
  });

  it('solo informa "Vía Router" cuando el método de conexión es VIA_MIKROTIK', async () => {
    queryBuilder.getMany.mockResolvedValueOnce([makeOlt({ connectionMethod: 'DIRECT', viaNode: undefined })]);
    const result = await service.export({});
    const text = result.buffer.toString('utf8');
    const dataLine = text.split('\r\n')[1];
    const columns = dataLine.split(',');
    // 7ma columna es "Vía Router MikroTik" — debe quedar vacía para conexión DIRECT.
    expect(columns[6]).toBe('');
  });

  it('usa el límite por defecto cuando el DTO no trae limit', async () => {
    await service.export({});
    expect(queryBuilder.take).toHaveBeenCalledWith(5000);
  });

  it('nunca imprime "undefined" para campos opcionales ausentes', async () => {
    queryBuilder.getMany.mockResolvedValueOnce([
      makeOlt({ firmwareVersion: undefined, lastCheckedAt: undefined, lastSuccessfulConnectionAt: undefined, viaNode: undefined }),
    ]);
    const result = await service.export({});
    const text = result.buffer.toString('utf8');
    expect(text).not.toContain('undefined');
  });
});
