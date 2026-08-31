/**
 * ARCHIVO: src/config/dgii.config.ts
 * CAPA: Configuración de Facturación Fiscal (DGII República Dominicana)
 * 
 * RESPONSABILIDAD:
 * - Define los parámetros de comunicación con los Web Services de la Dirección General de Impuestos Internos (DGII).
 * - Carga credenciales del emisor fiscal (RNC emisor, ambiente sandbox vs producción).
 * - Configura la ruta del certificado digital (.p12 / .pfx) para la firma criptográfica X.509 de comprobantes fiscales electrónicos (e-CF).
 * - Define URLs de recepción de e-CF, consulta de estado de track_id y secuencias de NCF autorizadas (B01, B02, E31, E32, etc.).
 * 
 * EXPORTA:
 * - dgiiConfig: registerAs('dgii', () => DgiiOptions)
 */
export {};
