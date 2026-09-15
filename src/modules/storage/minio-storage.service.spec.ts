import { Test, TestingModule } from '@nestjs/testing';
import { Readable } from 'stream';
import { MinioStorageService } from './minio-storage.service';

const bucketExistsMock = jest.fn();
const makeBucketMock = jest.fn();
const putObjectMock = jest.fn();
const presignedGetObjectMock = jest.fn();
const getObjectMock = jest.fn();

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    bucketExists: bucketExistsMock,
    makeBucket: makeBucketMock,
    putObject: putObjectMock,
    presignedGetObject: presignedGetObjectMock,
    getObject: getObjectMock,
  })),
}));

describe('MinioStorageService', () => {
  let service: MinioStorageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.MINIO_BUCKET = 'sumtech-daily-closures';

    const module: TestingModule = await Test.createTestingModule({
      providers: [MinioStorageService],
    }).compile();

    service = module.get<MinioStorageService>(MinioStorageService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('crea el bucket si no existe', async () => {
      bucketExistsMock.mockResolvedValue(false);

      await service.onModuleInit();

      expect(makeBucketMock).toHaveBeenCalledWith('sumtech-daily-closures');
    });

    it('no vuelve a crear el bucket si ya existe', async () => {
      bucketExistsMock.mockResolvedValue(true);

      await service.onModuleInit();

      expect(makeBucketMock).not.toHaveBeenCalled();
    });

    it('no lanza si falla la verificación del bucket (solo registra el error)', async () => {
      bucketExistsMock.mockRejectedValue(new Error('conexión rechazada'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('uploadBuffer', () => {
    it('sube el buffer y retorna un object key con el prefijo dado', async () => {
      putObjectMock.mockResolvedValue({ etag: 'abc' });

      const key = await service.uploadBuffer(Buffer.from('foto'), 'recibo #1.jpg', 'daily-closures/2026-09-07');

      expect(key).toMatch(/^daily-closures\/2026-09-07\//);
      expect(key).toContain('recibo__1.jpg');
      expect(putObjectMock).toHaveBeenCalledWith('sumtech-daily-closures', key, expect.any(Buffer), 4, undefined);
    });

    it('guarda el Content-Type como metadata cuando se provee, para que el navegador lo muestre inline en vez de forzar la descarga', async () => {
      putObjectMock.mockResolvedValue({ etag: 'abc' });

      const key = await service.uploadBuffer(Buffer.from('foto'), 'recibo.jpg', 'deposit-proofs/client-1', 'image/jpeg');

      expect(putObjectMock).toHaveBeenCalledWith(
        'sumtech-daily-closures',
        key,
        expect.any(Buffer),
        4,
        { 'Content-Type': 'image/jpeg' },
      );
    });
  });

  describe('getPresignedUrl', () => {
    it('genera una URL firmada con la expiración indicada', async () => {
      presignedGetObjectMock.mockResolvedValue('https://minio.local/presigned-url');

      const url = await service.getPresignedUrl('daily-closures/2026-09-07/foo.jpg', 900);

      expect(url).toBe('https://minio.local/presigned-url');
      expect(presignedGetObjectMock).toHaveBeenCalledWith('sumtech-daily-closures', 'daily-closures/2026-09-07/foo.jpg', 900);
    });
  });

  describe('getObjectBuffer', () => {
    it('descarga el objeto completo y lo devuelve como un único Buffer', async () => {
      const stream = Readable.from([Buffer.from('parte-1-'), Buffer.from('parte-2')]);
      getObjectMock.mockResolvedValue(stream);

      const buffer = await service.getObjectBuffer('contracts/signatures/contract-1/firma.png');

      expect(getObjectMock).toHaveBeenCalledWith('sumtech-daily-closures', 'contracts/signatures/contract-1/firma.png');
      expect(buffer.toString('utf-8')).toBe('parte-1-parte-2');
    });

    it('rechaza si el stream de MinIO emite un error (objeto inexistente / falla de red)', async () => {
      const stream = new Readable({
        read() {
          this.emit('error', new Error('The specified key does not exist.'));
        },
      });
      getObjectMock.mockResolvedValue(stream);

      await expect(service.getObjectBuffer('contracts/signatures/no-existe/firma.png')).rejects.toThrow(
        'The specified key does not exist.',
      );
    });
  });
});
