/**
 * Fila plana de exportación de clientes: una sola fuente de verdad para los
 * 3 formatos (CSV/Excel/PDF) y, a futuro, para el mapeo inverso de la
 * importación masiva desde el sistema legacy (mismo vocabulario de columnas).
 * Todos los valores ya vienen formateados como texto — los builders no
 * conocen entidades de TypeORM, solo estas filas.
 */
export interface ClientExportRow {
  nombre: string;
  tipoCliente: string;
  tipoDocumento: string;
  numeroDocumento: string;
  telefono: string;
  telefonoAlterno: string;
  email: string;
  direccion: string;
  sectorBarrio: string;
  municipio: string;
  provinciaCiudad: string;
  coordenadasGps: string;
  planActivo: string;
  numeroContrato: string;
  fechaInicioContrato: string;
  estadoContrato: string;
  estadoCliente: string;
  fechaAlta: string;
  clienteId: string;
}

export interface ClientExportColumn {
  key: keyof ClientExportRow;
  header: string;
  /** Ancho relativo sugerido para Excel/PDF (en caracteres aprox.) */
  width: number;
}

/**
 * Orden y encabezados canónicos de las 19 columnas del export, en el mismo
 * orden en que se muestran en los 3 formatos.
 */
export const CLIENT_EXPORT_COLUMNS: ClientExportColumn[] = [
  { key: 'nombre', header: 'Cliente / Razón Social', width: 28 },
  { key: 'tipoCliente', header: 'Tipo de Cliente', width: 14 },
  { key: 'tipoDocumento', header: 'Tipo Documento', width: 14 },
  { key: 'numeroDocumento', header: 'Número de Documento', width: 18 },
  { key: 'telefono', header: 'Teléfono', width: 14 },
  { key: 'telefonoAlterno', header: 'Teléfono Alterno', width: 14 },
  { key: 'email', header: 'Email', width: 26 },
  { key: 'direccion', header: 'Dirección', width: 30 },
  { key: 'sectorBarrio', header: 'Sector/Barrio', width: 18 },
  { key: 'municipio', header: 'Municipio', width: 16 },
  { key: 'provinciaCiudad', header: 'Provincia/Ciudad', width: 16 },
  { key: 'coordenadasGps', header: 'Coordenadas GPS', width: 20 },
  { key: 'planActivo', header: 'Plan Activo', width: 18 },
  { key: 'numeroContrato', header: 'N° de Contrato', width: 16 },
  { key: 'fechaInicioContrato', header: 'Fecha Inicio Contrato', width: 16 },
  { key: 'estadoContrato', header: 'Estado del Contrato', width: 16 },
  { key: 'estadoCliente', header: 'Estado del Cliente', width: 14 },
  { key: 'fechaAlta', header: 'Fecha de Alta', width: 14 },
  { key: 'clienteId', header: 'ID Cliente', width: 30 },
];

export interface ClientsExportResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
  totalExportado: number;
}
