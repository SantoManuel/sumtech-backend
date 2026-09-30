import { TenantContextService } from './tenant-context.service';

describe('TenantContextService', () => {
  let service: TenantContextService;

  beforeEach(() => {
    service = new TenantContextService();
  });

  describe('hasFeature', () => {
    it('retorna true si el tenant no tiene features definidos (permite acceso por defecto para dev)', () => {
      service.run({ tenantId: 't-1', slug: 'tenant1', dataSource: {} as any }, () => {
        expect(service.hasFeature('GENIEACS')).toBe(true);
        expect(service.hasFeature('CRM')).toBe(true);
      });
    });

    it('retorna true si features contiene comodín * o all: true', () => {
      service.run(
        {
          tenantId: 't-1',
          slug: 'tenant1',
          dataSource: {} as any,
          planFeatures: { '*': true },
        },
        () => {
          expect(service.hasFeature('GENIEACS')).toBe(true);
          expect(service.hasFeature('CUALQUIERA')).toBe(true);
        },
      );
    });

    it('evalúa correctamente los features específicos con insensibilidad a mayúsculas/minúsculas', () => {
      service.run(
        {
          tenantId: 't-1',
          slug: 'tenant1',
          dataSource: {} as any,
          planFeatures: {
            genieacs: true,
            mikrotik: false,
            billing: true,
          },
        },
        () => {
          expect(service.hasFeature('GENIEACS')).toBe(true);
          expect(service.hasFeature('genieacs')).toBe(true);
          expect(service.hasFeature('MIKROTIK')).toBe(false);
          expect(service.hasFeature('INVENTARIO')).toBe(false);
        },
      );
    });
  });
});
