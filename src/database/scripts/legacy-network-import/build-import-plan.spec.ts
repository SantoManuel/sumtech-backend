import { buildImportPlan, mapConnectionStatus, normalizeDocNumber } from './build-import-plan';
import { ClientLookupEntry, LegacyNetworkRow } from './types';

const makeRow = (overrides: Partial<LegacyNetworkRow> = {}): LegacyNetworkRow => ({
  rowNumber: 2,
  usuario: 't1@tecmas',
  nombre: 'Moises Perez',
  servicio: 't1',
  ip: '192.168.60.100',
  estado: 'Suspendido',
  planInternet: '50.0 Mbps 1600.00',
  router: 'RB Las Yayas',
  zona: 'RB Las Yayas',
  docNumber: '010-00000000-0',
  direccion: '',
  barrio: '',
  telefono: '8297477753',
  saldo: '200,00',
  fechaInstalacion: '20/01/2024 12:55',
  coordenadas: '',
  ciudadMunicipio: '',
  ...overrides,
});

describe('normalizeDocNumber', () => {
  it('quita guiones y otros separadores, y normaliza a mayúsculas', () => {
    expect(normalizeDocNumber('010-00000000-0')).toBe('010000000000');
    expect(normalizeDocNumber('010 00000000 0')).toBe('010000000000');
    expect(normalizeDocNumber('rnc-123-45')).toBe('RNC12345');
  });
});

describe('mapConnectionStatus', () => {
  it('reconoce los estados del sistema anterior en español, sin distinguir tildes/mayúsculas', () => {
    expect(mapConnectionStatus('Suspendido')).toBe('SUSPENDED');
    expect(mapConnectionStatus('suspendido')).toBe('SUSPENDED');
    expect(mapConnectionStatus('Activo')).toBe('ACTIVE');
    expect(mapConnectionStatus('Cortado')).toBe('CUT');
    expect(mapConnectionStatus('Cancelado')).toBe('CUT');
  });

  it('devuelve null (nunca un valor por defecto) para un estado no reconocido', () => {
    expect(mapConnectionStatus('En Mora')).toBeNull();
    expect(mapConnectionStatus('')).toBeNull();
  });
});

describe('buildImportPlan', () => {
  const clientLookup = (overrides: Partial<ClientLookupEntry> = {}): Map<string, ClientLookupEntry> => {
    const entry: ClientLookupEntry = {
      clientId: 'client-1',
      docNumber: '010-00000000-0',
      contracts: [{ contractId: 'contract-1', contractNumber: 'CTR-000123' }],
      ...overrides,
    };
    return new Map([[normalizeDocNumber(entry.docNumber), entry]]);
  };

  it('produce un ImportPlanItem completo para la fila de muestra real', () => {
    const { items, exceptions } = buildImportPlan([makeRow()], clientLookup());

    expect(exceptions).toHaveLength(0);
    expect(items).toEqual([
      {
        rowNumber: 2,
        clientId: 'client-1',
        contractId: 'contract-1',
        contractNumber: 'CTR-000123',
        zoneName: 'RB Las Yayas',
        nodeName: 'RB Las Yayas',
        username: 't1@tecmas',
        serviceAlias: 't1',
        ipAddress: '192.168.60.100',
        connectionStatus: 'SUSPENDED',
      },
    ]);
  });

  it('empareja el documento aunque el formato de guiones difiera entre el export y la base', () => {
    const lookup = clientLookup({ docNumber: '01000000000' });
    const { items, exceptions } = buildImportPlan([makeRow({ docNumber: '010-0000000-0' })], lookup);

    expect(exceptions).toHaveLength(0);
    expect(items[0].clientId).toBe('client-1');
  });

  it('reporta excepción cuando la fila no tiene documento', () => {
    const { items, exceptions } = buildImportPlan([makeRow({ docNumber: '' })], clientLookup());

    expect(items).toHaveLength(0);
    expect(exceptions[0].reason).toContain('no tiene número de documento');
  });

  it('reporta excepción cuando no se encuentra el cliente por documento (nunca lo descarta en silencio)', () => {
    const { items, exceptions } = buildImportPlan([makeRow({ docNumber: '999-9999999-9' })], clientLookup());

    expect(items).toHaveLength(0);
    expect(exceptions[0].reason).toContain('No se encontró ningún cliente');
  });

  it('reporta excepción cuando el cliente no tiene contratos vigentes', () => {
    const lookup = clientLookup({ contracts: [] });
    const { items, exceptions } = buildImportPlan([makeRow()], lookup);

    expect(items).toHaveLength(0);
    expect(exceptions[0].reason).toContain('no tiene contratos vigentes');
  });

  it('reporta excepción (con los números de contrato) cuando el cliente tiene más de un contrato vigente, en vez de adivinar cuál', () => {
    const lookup = clientLookup({
      contracts: [
        { contractId: 'contract-1', contractNumber: 'CTR-000123' },
        { contractId: 'contract-2', contractNumber: 'CTR-000456' },
      ],
    });
    const { items, exceptions } = buildImportPlan([makeRow()], lookup);

    expect(items).toHaveLength(0);
    expect(exceptions[0].reason).toContain('CTR-000123');
    expect(exceptions[0].reason).toContain('CTR-000456');
    expect(exceptions[0].reason).toContain('2 contratos');
  });

  it('reporta excepción cuando el estado de red no se reconoce, en vez de asumir un valor por defecto', () => {
    const { items, exceptions } = buildImportPlan([makeRow({ estado: 'En Mora' })], clientLookup());

    expect(items).toHaveLength(0);
    expect(exceptions[0].reason).toContain('En Mora');
  });

  it('usa PENDING cuando la columna Estado viene vacía (no es un error, es un dato faltante)', () => {
    const { items, exceptions } = buildImportPlan([makeRow({ estado: '' })], clientLookup());

    expect(exceptions).toHaveLength(0);
    expect(items[0].connectionStatus).toBe('PENDING');
  });

  it('deja zoneName/nodeName/username indefinidos cuando las columnas vienen vacías, en vez de guardar strings vacíos', () => {
    const { items } = buildImportPlan(
      [makeRow({ zona: '', router: '', usuario: '', servicio: '', ip: '' })],
      clientLookup(),
    );

    expect(items[0].zoneName).toBeUndefined();
    expect(items[0].nodeName).toBeUndefined();
    expect(items[0].username).toBeUndefined();
    expect(items[0].serviceAlias).toBeUndefined();
    expect(items[0].ipAddress).toBeUndefined();
  });

  it('procesa varias filas de forma independiente: una excepción no detiene el resto', () => {
    const rows = [
      makeRow({ rowNumber: 2, docNumber: '999-9999999-9' }),
      makeRow({ rowNumber: 3, docNumber: '010-00000000-0' }),
    ];
    const { items, exceptions } = buildImportPlan(rows, clientLookup());

    expect(exceptions).toHaveLength(1);
    expect(exceptions[0].rowNumber).toBe(2);
    expect(items).toHaveLength(1);
    expect(items[0].rowNumber).toBe(3);
  });
});
