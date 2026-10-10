export interface MinioConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  // Bucket dedicado a documentos fiscales (XML firmado + constancia DGII),
  // separado del bucket general porque exige retención de 10 años (norma DGII)
  // y nunca debe purgarse junto con fotos/reportes de otros módulos.
  fiscalDocumentsBucket: string;
}

export function loadMinioConfig(): MinioConfig {
  return {
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || '',
    secretKey: process.env.MINIO_SECRET_KEY || '',
    bucket: process.env.MINIO_BUCKET || 'sumtech-daily-closures',
    fiscalDocumentsBucket: process.env.MINIO_FISCAL_BUCKET || 'sumtech-fiscal-documents',
  };
}
