import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { loadMinioConfig, MinioConfig } from '../../config/minio.config';

/**
 * Almacenamiento de archivos (certificados DGII, fotos de gastos, contratos, logos)
 * vía MinIO con mecanismo de resiliencia local: si el almacenamiento MinIO
 * alcanza su umbral de espacio en disco (XMinioStorageFull) o presenta fallas
 * transitorias, resguarda el archivo en el sistema de archivos local de forma
 * segura sin interrumpir la operación del negocio.
 */
@Injectable()
export class MinioStorageService implements OnModuleInit {
  private readonly logger = new Logger(MinioStorageService.name);
  private readonly client: Client;
  private readonly config: MinioConfig;
  private readonly fallbackDir: string;

  constructor() {
    this.config = loadMinioConfig();
    this.client = new Client({
      endPoint: this.config.endPoint,
      port: this.config.port,
      useSSL: this.config.useSSL,
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
    });
    this.fallbackDir = path.resolve(process.cwd(), 'storage-fallback');
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
   * Sube un archivo en memoria y retorna el object key.
   * Si MinIO reporta disco lleno (XMinioStorageFull) o error de I/O,
   * se guarda en fallback local preservando exactamente el mismo objectKey.
   */
  async uploadBuffer(buffer: Buffer, originalName: string, prefix: string, contentType?: string): Promise<string> {
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `${prefix}/${randomUUID()}_${safeName}`;
    const metaData = contentType ? { 'Content-Type': contentType } : undefined;

    try {
      await this.client.putObject(this.config.bucket, objectKey, buffer, buffer.length, metaData);
      return objectKey;
    } catch (err: any) {
      this.logger.warn(
        `[MinioStorageService] MinIO no disponible para escritura (${err.code || err.message}). Activando almacenamiento local de respaldo para "${objectKey}".`,
      );
      try {
        const fullLocalPath = path.join(this.fallbackDir, this.config.bucket, objectKey);
        fs.mkdirSync(path.dirname(fullLocalPath), { recursive: true });
        fs.writeFileSync(fullLocalPath, buffer);
        this.logger.log(`[MinioStorageService] Objeto resguardado exitosamente en almacenamiento local: ${fullLocalPath}`);
        return objectKey;
      } catch (localErr: any) {
        this.logger.error(`[MinioStorageService] Error crítico guardando en fallback local: ${localErr.message}`);
        throw err;
      }
    }
  }

  async getPresignedUrl(objectKey: string, expirySeconds = 3600): Promise<string> {
    try {
      return await this.client.presignedGetObject(this.config.bucket, objectKey, expirySeconds);
    } catch (err: any) {
      const fullLocalPath = path.join(this.fallbackDir, this.config.bucket, objectKey);
      if (fs.existsSync(fullLocalPath)) {
        return `/api/v1/storage/fallback/${objectKey}`;
      }
      throw err;
    }
  }

  /**
   * Descarga el contenido completo de un objeto a memoria.
   * Consulta primero el almacenamiento local de respaldo si existe;
   * de lo contrario, transmite el stream desde MinIO.
   */
  async getObjectBuffer(objectKey: string): Promise<Buffer> {
    const fullLocalPath = path.join(this.fallbackDir, this.config.bucket, objectKey);
    if (fs.existsSync(fullLocalPath)) {
      return fs.readFileSync(fullLocalPath);
    }

    try {
      const stream = await this.client.getObject(this.config.bucket, objectKey);
      const chunks: Buffer[] = [];
      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    } catch (err: any) {
      if (fs.existsSync(fullLocalPath)) {
        return fs.readFileSync(fullLocalPath);
      }
      throw err;
    }
  }
}

