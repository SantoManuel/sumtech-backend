import { parseLegacyNetworkCsv } from './csv-parser';

const HEADER =
  'Usuario\tNombre\tServicio\tIp\tEstado\tPlan Internet\tRouter\tZona\tDNI/C.I./C.C./IFE\tDirección\tBarrio/Localidad\tTelefono\tSaldo\tFecha Instalación\tCoordenadas\tCiudad/Municipio\tAcción';

const SAMPLE_ROW =
  't1@tecmas\tMoises Perez\tt1\t192.168.60.100\tSuspendido\t50.0 Mbps 1600.00\tRB Las Yayas\tRB Las Yayas\t010-00000000-0\t\t\t8297477753\t200,00\t20/01/2024 12:55\t\t\t';

describe('parseLegacyNetworkCsv', () => {
  it('parsea la fila de muestra real del sistema anterior (delimitada por tabs)', () => {
    const rows = parseLegacyNetworkCsv(`${HEADER}\n${SAMPLE_ROW}`);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
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
    });
  });

  it('detecta el delimitador de punto y coma', () => {
    const semicolonHeader = HEADER.replace(/\t/g, ';');
    const semicolonRow = SAMPLE_ROW.replace(/\t/g, ';');

    const rows = parseLegacyNetworkCsv(`${semicolonHeader}\n${semicolonRow}`);

    expect(rows[0].usuario).toBe('t1@tecmas');
    expect(rows[0].docNumber).toBe('010-00000000-0');
  });

  it('detecta el delimitador de coma', () => {
    const commaHeader = HEADER.replace(/\t/g, ',');
    const commaRow = SAMPLE_ROW.replace(/\t/g, ',');

    const rows = parseLegacyNetworkCsv(`${commaHeader}\n${commaRow}`);

    expect(rows[0].usuario).toBe('t1@tecmas');
  });

  it('tolera columnas reordenadas porque mapea por nombre de encabezado, no por posición', () => {
    const reorderedHeader =
      'Zona\tRouter\tIp\tNombre\tUsuario\tDNI/C.I./C.C./IFE\tEstado\tServicio\tTelefono';
    const reorderedRow =
      'RB Las Yayas\tRB Las Yayas\t192.168.60.100\tMoises Perez\tt1@tecmas\t010-00000000-0\tSuspendido\tt1\t8297477753';

    const rows = parseLegacyNetworkCsv(`${reorderedHeader}\n${reorderedRow}`);

    expect(rows[0].nombre).toBe('Moises Perez');
    expect(rows[0].usuario).toBe('t1@tecmas');
    expect(rows[0].docNumber).toBe('010-00000000-0');
    expect(rows[0].zona).toBe('RB Las Yayas');
  });

  it('es robusto a encabezados con tildes mal codificadas (mojibake)', () => {
    const mojibakeHeader = HEADER.replace('Dirección', 'DirecciÃ³n').replace('Instalación', 'InstalaciÃ³n');

    // No debe explotar solo porque "Dirección"/"Instalación" llegaron mal codificados —
    // el resto de columnas reconocidas (>= mínimo) es suficiente para procesar el archivo.
    expect(() => parseLegacyNetworkCsv(`${mojibakeHeader}\n${SAMPLE_ROW}`)).not.toThrow();
  });

  it('ignora líneas vacías', () => {
    const rows = parseLegacyNetworkCsv(`${HEADER}\n\n${SAMPLE_ROW}\n\n`);
    expect(rows).toHaveLength(1);
  });

  it('lanza un error claro si el archivo está vacío', () => {
    expect(() => parseLegacyNetworkCsv('')).toThrow('El archivo está vacío.');
  });

  it('lanza un error claro si el encabezado no es reconocible como el formato heredado', () => {
    expect(() => parseLegacyNetworkCsv('Columna A,Columna B,Columna C\nx,y,z')).toThrow(
      /No se reconocieron suficientes columnas/,
    );
  });

  it('numera las filas contando el encabezado como fila 1', () => {
    const rows = parseLegacyNetworkCsv(`${HEADER}\n${SAMPLE_ROW}\n${SAMPLE_ROW}`);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[1].rowNumber).toBe(3);
  });
});
