import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';
import { randomUUID } from 'crypto';
import { loadMinioConfig, MinioConfig } from '../../config/minio.config';

/**
 * Almacenamiento de archivos (fotos de facturas de gastos del Cierre de Jornada)
 * vía MinIO — object storage autoalojado compatible con la API de S3. Bucket
 * privado: las fotos se sirven siempre vía URL firmada con expiración, nunca
 * como una ruta pública directa.
 */
@Injectable()
export class MinioStorageService implements OnModuleInit {
  private readonly logger = new Logger(MinioStorageService.name);
  private readonly client: Client;
  private readonly config: MinioConfig;

  constructor() {
    this.config = loadMinioConfig();
    this.client = new Client({
      endPoint: this.config.endPoint,
      port: this.config.port,
      useSSL: this.config.useSSL,
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
    });
  }

  async onModuleInit() {
    try {
      const exists = await this.client.bucketExists(this.config.bucket);
      if (!exists) {
        await this.client.makeBucket(this.config.bucket);
        this.logger.log(`Bucket "${this.config.bucket}" creado en MinIO.`);
      }
    } catch (error: any) {
      this.logger.error(`No se pudo verificar/crear el bucket de MinIO: ${error.message}`);
    }
  }

  /**
   * Sube un archivo en memoria y retorna el object key (no la URL — las fotos
   * se leen siempre a través de getPresignedUrl, nunca por una ruta pública).
   *
   * `contentType` (ej. "image/jpeg", "application/pdf") se guarda como
   * metadata del objeto en MinIO — sin esto, MinIO sirve el archivo como
   * `application/octet-stream` y el navegador fuerza la descarga en vez de
   * mostrarlo inline (imagen o PDF) al abrir la URL firmada.
   */
  async uploadBuffer(buffer: Buffer, originalName: string, prefix: string, contentType?: string): Promise<string> {
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `${prefix}/${randomUUID()}_${safeName}`;
    const metaData = contentType ? { 'Content-Type': contentType } : undefined;
    await this.client.putObject(this.config.bucket, objectKey, buffer, buffer.length, metaData);
    return objectKey;
  }

  async getPresignedUrl(objectKey: string, expirySeconds = 3600): Promise<string> {
    return this.client.presignedGetObject(this.config.bucket, objectKey, expirySeconds);
  }

  /**
   * Descarga el contenido completo de un objeto a memoria — para cuando el
   * consumidor necesita los bytes directamente (ej. pdfkit dibujando una
   * imagen de firma dentro de un PDF), no una URL para que el navegador la
   * pida por su cuenta.
   */
  async getObjectBuffer(objectKey: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.config.bucket, objectKey);
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}
