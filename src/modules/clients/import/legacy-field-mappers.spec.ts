import {
  normalizeDocNumber,
  inferDocType,
  mapEstadoToContractStatus,
  parsePlanInternet,
  parseInstallDate,
  parseGpsCoordinates,
  parseSaldo,
  buildLocationKey,
} from './legacy-field-mappers';

describe('normalizeDocNumber', () => {
  it('quita guiones y espacios, y pone en mayúsculas', () => {
    expect(normalizeDocNumber('010-00000000-0')).toBe('010000000000');
    expect(normalizeDocNumber(' abc-123 ')).toBe('ABC123');
  });

  it('con string vacío o undefined devuelve string vacío', () => {
    expect(normalizeDocNumber('')).toBe('');
    expect(normalizeDocNumber(undefined as any)).toBe('');
  });
});

describe('inferDocType', () => {
  it('11 dígitos -> CEDULA con confianza', () => {
    expect(inferDocType('001-1234567-8')).toEqual({ docType: 'CEDULA', confident: true });
  });

  it('9 dígitos -> RNC con confianza', () => {
    expect(inferDocType('131000000')).toEqual({ docType: 'RNC', confident: true });
  });

  it('formato irreconocible -> CEDULA sin confianza (nunca bloquea la fila)', () => {
    expect(inferDocType('X-12345')).toEqual({ docType: 'CEDULA', confident: false });
  });

  it('vacío -> CEDULA sin confianza', () => {
    expect(inferDocType('')).toEqual({ docType: 'CEDULA', confident: false });
  });
});

describe('mapEstadoToContractStatus', () => {
  it('mapea sinónimos en español e inglés, sin distinguir acentos/mayúsculas', () => {
    expect(mapEstadoToContractStatus('Activo')).toEqual({ status: 'ACTIVE', recognized: true });
    expect(mapEstadoToContractStatus('SUSPENDIDO')).toEqual({ status: 'SUSPENDED', recognized: true });
    expect(mapEstadoToContractStatus('cortado')).toEqual({ status: 'TERMINATED', recognized: true });
    expect(mapEstadoToContractStatus('pendiente')).toEqual({ status: 'PENDING_INSTALL', recognized: true });
  });

  it('vacío -> PENDING_INSTALL, recognized=true (no es un valor desconocido, simplemente no vino)', () => {
    expect(mapEstadoToContractStatus('')).toEqual({ status: 'PENDING_INSTALL', recognized: true });
  });

  it('valor desconocido -> PENDING_INSTALL, recognized=false (para marcar revisión, nunca bloquea)', () => {
    expect(mapEstadoToContractStatus('en el limbo')).toEqual({ status: 'PENDING_INSTALL', recognized: false });
  });
});

describe('parsePlanInternet', () => {
  it('parsea el formato "50.0 Mbps 1600.00"', () => {
    expect(parsePlanInternet('50.0 Mbps 1600.00')).toEqual({ speedMbps: 50, monthlyPrice: 1600 });
  });

  it('tolera separador de miles y símbolo de moneda en el precio', () => {
    expect(parsePlanInternet('100 Mbps RD$1,600.00')).toEqual({ speedMbps: 100, monthlyPrice: 1600 });
  });

  it('sin precio detectable, monthlyPrice queda en 0 (no descarta la velocidad)', () => {
    expect(parsePlanInternet('50 Mbps')).toEqual({ speedMbps: 50, monthlyPrice: 0 });
  });

  it('sin "Mbps" reconocible -> null', () => {
    expect(parsePlanInternet('Plan Premium')).toBeNull();
  });

  it('vacío -> null', () => {
    expect(parsePlanInternet('')).toBeNull();
  });
});

describe('parseInstallDate', () => {
  it('parsea "20/01/2024 12:55" -> "2024-01-20"', () => {
    expect(parseInstallDate('20/01/2024 12:55')).toBe('2024-01-20');
  });

  it('parsea solo fecha sin hora', () => {
    expect(parseInstallDate('05/03/2023')).toBe('2023-03-05');
  });

  it('formato inválido -> null', () => {
    expect(parseInstallDate('no-es-fecha')).toBeNull();
    expect(parseInstallDate('13/45/2024')).toBeNull();
  });

  it('vacío -> null', () => {
    expect(parseInstallDate('')).toBeNull();
  });
});

describe('parseGpsCoordinates', () => {
  it('parsea "18.4861,-69.9312"', () => {
    expect(parseGpsCoordinates('18.4861,-69.9312')).toEqual({ lat: 18.4861, lng: -69.9312 });
  });

  it('tolera espacios alrededor de la coma', () => {
    expect(parseGpsCoordinates('18.4861, -69.9312')).toEqual({ lat: 18.4861, lng: -69.9312 });
  });

  it('fuera de rango -> null', () => {
    expect(parseGpsCoordinates('200,200')).toBeNull();
  });

  it('vacío o sin coma -> null', () => {
    expect(parseGpsCoordinates('')).toBeNull();
    expect(parseGpsCoordinates('18.4861')).toBeNull();
  });
});

describe('parseSaldo', () => {
  it('parsea "200,00" (coma decimal) -> 200', () => {
    expect(parseSaldo('200,00')).toBe(200);
  });

  it('parsea "1,600.00" (coma de miles + punto decimal) -> 1600', () => {
    expect(parseSaldo('1,600.00')).toBe(1600);
  });

  it('parsea "RD$500" -> 500', () => {
    expect(parseSaldo('RD$500')).toBe(500);
  });

  it('vacío, "0" o negativo -> 0', () => {
    expect(parseSaldo('')).toBe(0);
    expect(parseSaldo('0')).toBe(0);
    expect(parseSaldo('-50')).toBe(0);
  });

  it('texto no numérico -> 0 (nunca lanza)', () => {
    expect(parseSaldo('al día')).toBe(0);
  });
});

describe('buildLocationKey', () => {
  it('normaliza mayúsculas y espacios para agrupar variantes del mismo lugar', () => {
    expect(buildLocationKey('Las Yayas', 'Azua')).toBe(buildLocationKey('  las yayas  ', 'AZUA'));
  });

  it('barrios distintos producen claves distintas', () => {
    expect(buildLocationKey('Las Yayas', 'Azua')).not.toBe(buildLocationKey('Ensanche Ozama', 'Azua'));
  });
});
