import { PlatformDataSource } from '../../config/platform-database.config';
import { DataSource } from 'typeorm';
import { migrateAllTenants } from '../migrate-all-tenants';

jest.mock('../../config/platform-database.config', () => ({
  PlatformDataSource: {
    isInitialized: true,
    initialize: jest.fn().mockResolvedValue(null),
    destroy: jest.fn().mockResolvedValue(null),
    query: jest.fn(),
  },
}));

jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return {
    ...actual,
    DataSource: jest.fn(),
  };
});

describe('migrateAllTenants (Fan-out runner)', () => {
  let mockTenantDs: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTenantDs = {
      isInitialized: true,
      initialize: jest.fn().mockResolvedValue(null),
      destroy: jest.fn().mockResolvedValue(null),
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT "filename" FROM "sec"."schema_migrations"')) {
          // Simular que ya tiene 54 migraciones aplicadas
          return Promise.resolve([
            { filename: '001_add_tickets_scheduling_columns.sql' },
          ]);
        }
        return Promise.resolve([]);
      }),
    };

    (DataSource as unknown as jest.Mock).mockImplementation(() => mockTenantDs);
  });

  it('exits cleanly with 0 tenants when no active tenants exist', async () => {
    (PlatformDataSource.query as jest.Mock).mockResolvedValueOnce([]);

    const summary = await migrateAllTenants();

    expect(summary.totalTenants).toBe(0);
    expect(summary.successfulTenants).toBe(0);
    expect(summary.failedTenants).toHaveLength(0);
  });

  it('migrates active tenants and records pending migrations in sec.schema_migrations', async () => {
    const mockTenants = [
      { id: '1', name: 'ISP Azua', slug: 'ispazua', dbName: 'tenant_ispazua', status: 'ACTIVE' },
      { id: '2', name: 'Cable Sur', slug: 'cablesur', dbName: 'tenant_cablesur', status: 'TRIAL' },
    ];

    (PlatformDataSource.query as jest.Mock).mockResolvedValueOnce(mockTenants);

    const summary = await migrateAllTenants();

    expect(summary.totalTenants).toBe(2);
    expect(summary.successfulTenants).toBe(2);
    expect(summary.failedTenants).toHaveLength(0);
    expect(mockTenantDs.initialize).toHaveBeenCalledTimes(2);
    expect(mockTenantDs.destroy).toHaveBeenCalledTimes(2);
  });

  it('records failed tenants in summary without crashing remaining tenants', async () => {
    const mockTenants = [
      { id: '1', name: 'Failing ISP', slug: 'failing', dbName: 'tenant_failing', status: 'ACTIVE' },
      { id: '2', name: 'Healthy ISP', slug: 'healthy', dbName: 'tenant_healthy', status: 'ACTIVE' },
    ];

    (PlatformDataSource.query as jest.Mock).mockResolvedValueOnce(mockTenants);

    let callCount = 0;
    (DataSource as unknown as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          isInitialized: false,
          initialize: jest.fn().mockRejectedValue(new Error('Connection refused on port 5432')),
          destroy: jest.fn().mockResolvedValue(null),
        };
      }
      return mockTenantDs;
    });

    const summary = await migrateAllTenants();

    expect(summary.totalTenants).toBe(2);
    expect(summary.successfulTenants).toBe(1);
    expect(summary.failedTenants).toHaveLength(1);
    expect(summary.failedTenants[0].slug).toBe('failing');
    expect(summary.failedTenants[0].error).toContain('Connection refused');
  });

  it('filters by tenantSlug when option is provided', async () => {
    (PlatformDataSource.query as jest.Mock).mockResolvedValueOnce([
      { id: '1', name: 'ISP Azua', slug: 'ispazua', dbName: 'tenant_ispazua', status: 'ACTIVE' },
    ]);

    const summary = await migrateAllTenants({ tenantSlug: 'ispazua' });

    expect(PlatformDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('LOWER("slug") = LOWER($1)'),
      ['ispazua'],
    );
    expect(summary.totalTenants).toBe(1);
  });
});
